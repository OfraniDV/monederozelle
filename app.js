// app.js — versión completa
// -----------------------------------------------------------------------------
// 1. Carga de dependencias y configuración
// -----------------------------------------------------------------------------
require('dotenv').config();
const { Scenes, session } = require('telegraf');

// Bot principal (./bot.js debe exportar una instancia de Telegraf ya configurada)
const bot = require('./bot');

// Pool y esquema
const crearTablaUsuarios = require('./psql/tablausuarios');
const initWalletSchema   = require('./psql/initWalletSchema');

// Legacy commands (monotabla)
/* eslint-disable sort-imports */
const crearCuenta     = require('./commands/crearcuenta');
const listarCuentas   = require('./commands/cuentas');
const eliminarCuenta  = require('./commands/eliminarcuentas');
const agregarCredito  = require('./commands/credito');
const agregarDebito   = require('./commands/debito');
const resumirCuenta   = require('./commands/resumen');
const resumenTotal    = require('./commands/resumentotal');
const comandosMeta    = require('./commands/comandos');
/* eslint-enable sort-imports */

// Accesos
const {
  agregarUsuario,
  eliminarUsuario,
  usuarioExiste,
} = require('./commands/usuariosconacceso');

// Asistentes (nuevo sistema)
const registerMoneda = require('./commands/moneda');
const registerBanco  = require('./commands/banco');
const registerAgente = require('./commands/agente');
const tarjetaWizard  = require('./commands/tarjeta_wizard');
const listarTarjetas = require('./commands/tarjetas');


// -----------------------------------------------------------------------------
// 2. Inicialización de la base (sin poblar datos)
// -----------------------------------------------------------------------------
(async () => {
  await crearTablaUsuarios();   // tabla 'usuarios'
  await initWalletSchema();     // esquema wallet vacío
})();

// -----------------------------------------------------------------------------
// 3. Configuración de Scenes / Stage (para wizards)
// -----------------------------------------------------------------------------
const stage = new Scenes.Stage([tarjetaWizard], { ttl: 300 });
bot.use(session());
bot.use(stage.middleware());


// Registrar CRUDs que añaden sus propios wizards al stage
registerMoneda(bot, stage);
registerBanco(bot, stage);   
registerAgente(bot, stage);  

listarTarjetas(bot); 

// Atajo para lanzar el wizard de tarjeta
bot.command('tarjeta', (ctx) => ctx.scene.enter('TARJETA_WIZ'));

// -----------------------------------------------------------------------------
// 4. Comando /start básico
// -----------------------------------------------------------------------------
bot.command('start', (ctx) => {
  const username = ctx.from.first_name || 'Usuario';
  ctx.reply(`Hola, ${username} 😊 Aún estoy aprendiendo, pero pronto podré ayudarte…`);
});

// -----------------------------------------------------------------------------
// 5. Middleware de verificación de acceso
// -----------------------------------------------------------------------------
const verificarAcceso = async (ctx, next) => {
  const userId = ctx.from.id.toString();
  const esPropietario = userId === process.env.OWNER_ID;
  const tieneAcceso   = await usuarioExiste(userId);
  console.log(`Verificando acceso – ID:${userId} propietario:${esPropietario} acceso:${tieneAcceso}`);
  return (esPropietario || tieneAcceso) ? next(ctx) : ctx.reply('No tienes permiso.');
};

// -----------------------------------------------------------------------------
// 6. Comandos legacy (seguirán funcionando)
// -----------------------------------------------------------------------------
bot.command('comandos', verificarAcceso, (ctx) => {
  let msg = 'Lista de comandos disponibles:\n\n';
  comandosMeta.forEach(c =>
    msg += `• ${c.nombre}\n  ${c.descripcion}\n  Uso: ${c.uso}\n\n`
  );
  ctx.reply(msg);
});

bot.command('crearcuenta',   verificarAcceso, (ctx) => crearCuenta(ctx));
bot.command('miscuentas',    verificarAcceso, (ctx) => listarCuentas(ctx));
bot.command('eliminarcuenta',verificarAcceso, (ctx) => eliminarCuenta(ctx));
bot.command('credito',       verificarAcceso, (ctx) => agregarCredito(ctx));
bot.command('debito',        verificarAcceso, (ctx) => agregarDebito(ctx));
bot.command('resumen',       verificarAcceso, (ctx) => resumirCuenta(ctx));
bot.command('resumentotal',  verificarAcceso, (ctx) => resumenTotal(ctx));

// -----------------------------------------------------------------------------
// 7. Gestión de accesos (propietario)
// -----------------------------------------------------------------------------
bot.command('daracceso', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.OWNER_ID) return ctx.reply('Sin permiso.');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('Indica un ID.');
  if (await usuarioExiste(id)) return ctx.reply('Ese usuario ya tiene acceso.');
  await agregarUsuario(id);
  ctx.reply(`Acceso otorgado a ${id}.`);
});

bot.command('denegaracceso', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.OWNER_ID) return ctx.reply('Sin permiso.');
  const id = ctx.message.text.split(' ')[1];
  if (!id) return ctx.reply('Indica un ID.');
  if (!(await usuarioExiste(id))) return ctx.reply('Ese usuario no existe.');
  await eliminarUsuario(id);
  ctx.reply(`Acceso revocado a ${id}.`);
});

// -----------------------------------------------------------------------------
// 8. Arranque
// -----------------------------------------------------------------------------
bot.launch()
  .then(() => console.log('🤖 Bot en línea.'))
  .catch((e) => console.error('Fallo al lanzar bot:', e));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
