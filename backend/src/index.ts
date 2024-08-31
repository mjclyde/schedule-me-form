import { App } from './app';
import { DB } from './db';
import { Environment } from './environment';

const app = new App(Environment.PORT);
app.init().then(() => app.start());

process.on('SIGINT', () => kill());
process.on('SIGTERM', () => kill());

async function kill() {
  console.log('Killing App...');
  await app.stop();
  console.log('Closing DB Connection...');
  await DB.close();
  console.log('Exiting...');
  process.exit();
}
