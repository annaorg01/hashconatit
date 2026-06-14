import 'dotenv/config';
import app from './app.js';
import { startScheduler } from './services/broadcaster.js';

const PORT = process.env.PORT || 3000;

startScheduler();

app.listen(PORT, () => {
  console.log(`\n🟢 השכונתית running → http://localhost:${PORT}`);
  console.log(`   Landing page : http://localhost:${PORT}/?machine=building_A`);
  console.log(`   Admin panel  : http://localhost:${PORT}/admin\n`);
});
