const fs = require('fs');
const Arweave = require('arweave/node')
const parse = require('url-parse')
const Hapi = require('@hapi/hapi');
const puppeteer = require('puppeteer');

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
  default: 'https://arweave.net:443',
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
    protocol: argv.arweave.protocol || 'https'
});

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
      let buffer = await page.screenshot({fullPage: true, encoding: 'base64'});
      
      await browser.close();

      return {
        status: 'ok',
	selfie: buffer,
	site: site
      }
    
    }
  })


  await server.start();
  console.log('Server running on %s', server.info.uri);
}

process.on('unhandledRejection', (err) => {
    console.log(err);
    process.exit(1);
});

init();
