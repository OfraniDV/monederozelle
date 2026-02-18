const crearTablaUsuarios = require('../scripts/tablausuarios');
const initWalletSchema = require('../scripts/initWalletSchema');
const { bootstrap } = require('../scripts/ensureIndexesAndExtensions');
const seedMinimal = require('../scripts/seedMinimal');

test('utility scripts run without errors', async () => {
  await crearTablaUsuarios();
  await initWalletSchema();
  await bootstrap();
  await seedMinimal();
});
