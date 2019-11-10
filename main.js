const fs = require('fs');
const Arweave = require('arweave/node');
const parse = require('url-parse');
const Hapi = require('@hapi/hapi');
const puppeteer = require('puppeteer');
const fetch = require("node-fetch");


const argv = require('yargs')
  .usage('Usage: $0 <command> [options]')
  .command('selfie_bot', 'Server to take photographies to sites')
  .option('port', {
    alias: 'p',
    nargs: 1,
    description: 'server port number',
    default: 1908,
    type: 'number'
  })
  .option('host', {
    alias: 'H',
    nargs: 1,
    description: 'server host address',
    default: 'localhost',
    type: 'string'
  })
  .option('arweave', {
    alias: 'a',
    nargs: 1,
    coerce: parse,
    description: 'Arweave URL host',
    default: 'https://arweave.net',
    type: 'string'
  })
  .option('wallet-file', {
    alias: 'w',
    nargs: 1,
    description: 'wallet to get ar tokens',
    demandOption: 'Specify a wallet file',
    type: 'string'
  })
  .help('help')
  .argv;


const raw_wallet = fs.readFileSync(argv.walletFile);
const wallet = JSON.parse(raw_wallet);

const arweave = Arweave.init({
  host: argv.arweave.hostname,
  port: argv.arweave.port || 443,
  protocol: argv.arweave.protocol.replace(':', '') || 'https'
});

const take_screenshot = async (browser, page, site, enconding='base64', fullpage=true, viewport={ width: 1920, height: 1080 }) => {
  await page.setViewport(viewport);
  let buffer = await page.screenshot({fullPage: fullpage, encoding: enconding});
  return buffer;
};

const get_title = async (page) => {
  try {
    const element = await page.$("title");
    return await page.evaluate(element => element.textContent, element);
  } catch (e) {
    console.log(e);
    return 'Ups, i\'m down?'
  }
};

async function dispatchTX(tx) {
  // Set transaction anchor
  tx.last_tx = await arweave.api.get('/tx_anchor').then(x => x.data)

  // Sign and dispatch the tx
  await arweave.transactions.sign(tx, wallet)
  const response = await arweave.transactions.post(tx);

  let output = `Transaction ${tx.get('id')} dispatched with response: ${response.status}.`;
  console.log(output);

  return {
    response: response,
    txID: tx.get('id'),
    status: response.status
  };
}

const init = async () => {
  const server = Hapi.server({
    port: argv.port,
    host: argv.host
  });

  server.route({
    method: 'GET',
    path: '/',
    handler: (request, h) => {
      return 'Last sites photos';
    }
  });

  server.route({
    method: 'POST',
    path: '/photo',
    handler: async (request, h) => {
      let site_raw = request.payload.site;
      let site = parse(site_raw);

      const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
      const page = await browser.newPage();
      await page.goto(site_raw);
      const screenshot = await take_screenshot(browser, page, site_raw, 'binary');
      const title = await get_title(page);
      await browser.close();

      let address;
      let balance;

      address = await arweave.wallets.jwkToAddress(wallet);
      balance = await arweave.wallets.getBalance(address);
      try {
        let tx = await arweave.createTransaction({data: screenshot}, wallet);
        const tags = {
          host: site.host,
          domain: site.host.split('.').slice(-2).join('.'),
          path: site.path || '/',
          type: 'binary',
          createdBy: 'Selfie Web',
          'Content-Type': 'image/png',
          'User-Agent': 'Chrome/latest',
          'page:url': site.origin,
          'page:title': title,
          'page:timestamp': Date.now() / 1000 | 0,
        };

        Object.keys(tags).map((key) => {
          tx.addTag(key, tags[key]);
        });

        let {response, txID, status} = await dispatchTX(tx);
        return {
          status: 'ok',
          address: address,
          balance: balance,
          txID: txID,
          txStatus: status,
          site: site
        }
      } catch (e) {
        console.log(e);
      }
      return {
        status: 'ok',
        address: address,
        balance: balance,
        txID: -1,
        txStatus: -1,
        site: site
      }
    }
  });


  await server.start();
  console.log('Server running on %s', server.info.uri);
};

process.on('unhandledRejection', (err) => {
  console.log(err);
  process.exit(1);
});

process.on('uncaughtException', function (err) {
  console.log(err);
  process.exit(1);

});

init();

