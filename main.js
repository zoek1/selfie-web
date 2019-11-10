const fs = require('fs');
const Arweave = require('arweave/node');
const parse = require('url-parse');
const Hapi = require('@hapi/hapi');
const puppeteer = require('puppeteer');
const Sentencer = require('sentencer');


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


const take_screenshot = async (page, enconding, fullpage, viewport) => {
  await page.setViewport(viewport);
  return await page.screenshot({fullPage: fullpage, encoding: enconding});
};

const get_title = async (page, site) => {
  try {
    const element = await page.$("title");
    return await page.evaluate(element => element.textContent, element);
  } catch (e) {

    console.log(e);

    Sentencer.configure({
      nounList: ['site', 'page', 'land', 'world', 'dimension', 'planet'],
      adjectiveList: ['defeated', 'deteriorated', 'ruined', 'losing status'],
    });

    return Sentencer.make(`Ups, this {{ nouns }} was {{ adjective }}, long live to ${site}!`)
  }
};

const get_page = async (site, type='png', enconding='base64', fullpage=true,
                        viewport={ width: 1920, height: 1080 }) => {
  const browser = await puppeteer.launch({args: ['--no-sandbox', '--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.goto(site);
  const screenshot = await take_screenshot(page, enconding, fullpage, viewport);
  const title = await get_title(page, site);
  await browser.close();

  const metadata = {
    'Content-Type': 'image/'+type,
    'page:title': title,
    'User-Agent': 'Chrome/latest',
    'page:timestamp': Date.now() / 1000 | 0,
    'page:url': site
  };

  return {
     screenshot, metadata
  }
};

async function dispatchTX(image, tags) {
  const tx = await arweave.createTransaction({data: image}, wallet);

  Object.keys(tags).map((key) => {
    tx.addTag(key, tags[key]);
  });

  // Sign and dispatch the tx
  await arweave.transactions.sign(tx, wallet);
  const response = await arweave.transactions.post(tx);

  let output = `Transaction ${tx.get('id')} dispatched with response: ${response.status}.`;
  console.log(output);

  return {
    response: response,
    tx: tx
  };
}

const selfie_and_post = async (site_raw, config) => {
  let { metadata, screenshot } = await get_page(site_raw);
  let site = parse(site_raw);

  const tags = {
    host: site.host,
    domain: site.host.split('.').slice(-2).join('.'),
    path: site.path || '/',
    type: 'binary',
    createdBy: 'Selfie Web',
    ...metadata
  };
  let {response, tx} = await dispatchTX(screenshot, tags);

  return { metadata, screenshot, tags, tx, response, site };
}

const init = async () => {
  const server = Hapi.server({
    port: argv.port,
    host: argv.host
  });

  server.route({
    method: 'GET',
    path: '/',
    handler: async (request, h) => {
      const address = await arweave.wallets.jwkToAddress(wallet);
      const balance = await arweave.wallets.getBalance(address);

      return {
        status: 'ok',
        address: address,
        balance: balance
      };
    }
  });

  server.route({
    method: 'POST',
    path: '/photo',
    handler: async (request, h) => {
      let site_raw = request.payload.site;

      try {
        let {tx, response, site } = await selfie_and_post(site_raw, {});
        return {
          status: 'ok',
          txID: tx.get('id'),
          txStatus: response.status,
          site: site
        }
      } catch (e) {
        console.log(e);
      }
      return {
        status: 'ok',
        txID: -1,
        txStatus: -1,
        site: site_raw
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

