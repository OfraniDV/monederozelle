const { Telegraf } = require('telegraf');
const crearCuenta = require('./commands/crearcuenta');
const listarCuentas = require('./commands/cuentas');
const eliminarCuenta = require('./commands/eliminarcuentas');
const agregarCredito = require('./commands/credito'); 
const agregarDebito = require('./commands/debito'); 
const resumirCuenta = require('./commands/resumen'); 
const resumenTotal = require('./commands/resumentotal');

// Importamos el archivo de comandos
const comandos = require('./commands/comandos');

const {
  agregarUsuario,
  eliminarUsuario,
  usuarioExiste
} = require('./commands/usuariosconacceso');


const crearTablaUsuarios = require('./psql/tablausuarios');
// Crear la tabla 'usuarios' antes de iniciar el bot
crearTablaUsuarios();

// Instancia del Bot
const bot = require('./bot');

bot.command('start', (ctx) => {
  const username = ctx.from.first_name || 'Usuario';
  const message = `Hola, ${username} 😊 Ya estoy aprendiendo algunas cosas, pronto podré ayudarte... Por el momento, no puedo hacer mucho por ti, aún me están programando 🤖`;
  ctx.reply(message);
});


// Función de middleware para verificar el acceso del usuario
const verificarAcceso = async (ctx, next) => {
  const userId = ctx.from.id;
  const esPropietario = userId.toString() === process.env.OWNER_ID;
  const tieneAcceso = await usuarioExiste(userId);

  console.log(`Verificando acceso para el usuario con ID ${userId}...`);
  console.log(`Es el propietario: ${esPropietario}`);
  console.log(`Tiene acceso: ${tieneAcceso}`);

  if (esPropietario || tieneAcceso) {
    return next(ctx);
  } else {
    ctx.reply('No tienes permiso para ejecutar este comando.');
  }
};

// Añadir comando para listar todos los comandos
bot.command('comandos', verificarAcceso, (ctx) => {
  let message = 'Lista de comandos disponibles:\n\n';
  comandos.forEach(comando => {
    message += `\nNombre: ${comando.nombre}\nDescripción: ${comando.descripcion}\nPermiso: ${comando.permiso}\nUso: ${comando.uso}\n`;
  });
  ctx.reply(message);
});

bot.command('crearcuenta', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando crearcuenta para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await crearCuenta(ctx);
  } catch (error) {
      console.error(`Error al ejecutar el comando crearcuenta para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('miscuentas', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando miscuentas para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await listarCuentas(ctx);
  } catch (error) {
      console.error(`Error al ejecutar el comando miscuentas para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('eliminarcuenta', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando eliminarcuenta para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await eliminarCuenta(ctx);
  } catch (error) {
      console.error(`Error al ejecutar el comando eliminarcuenta para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('credito', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando credito para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await agregarCredito(ctx); 
  } catch (error) {
      console.error(`Error al ejecutar el comando credito para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('debito', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando debito para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await agregarDebito(ctx); 
  } catch (error) {
      console.error(`Error al ejecutar el comando debito para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('resumen', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando resumen para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await resumirCuenta(ctx);
  } catch (error) {
      console.error(`Error al ejecutar el comando resumen para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('resumentotal', verificarAcceso, async (ctx) => {
  try {
      console.log(`Ejecutando el comando resumentotal para el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
      await resumenTotal(ctx);
  } catch (error) {
      console.error(`Error al ejecutar el comando resumentotal para el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('daracceso', async (ctx) => {
  try {
    console.log(`Ejecutando el comando daracceso por el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
    if (ctx.from.id.toString() === process.env.OWNER_ID) {
      const userId = ctx.message.text.split(' ')[1];

      if (!userId) {
        ctx.reply('Por favor, ingresa el ID de usuario.');
        return;
      }

      const existe = await usuarioExiste(userId);

      console.log(`Verificando si el usuario con ID ${userId} existe: ${existe}`);

      if (existe) {
        ctx.reply(`El usuario con ID ${userId} ya tiene acceso.`);
      } else {
        await agregarUsuario(userId);
        ctx.reply(`Acceso otorgado al usuario con ID ${userId}.`);
        console.log(`Acceso otorgado al usuario con ID ${userId}.`);
      }
    } else {
      ctx.reply('No tienes permiso para ejecutar este comando.');
      console.log(`El usuario ${ctx.from.username} (${ctx.from.id}) intentó ejecutar el comando daracceso pero no tiene permisos.`);
    }
  } catch (error) {
    console.error(`Error al ejecutar el comando daracceso por el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});

bot.command('denegaracceso', async (ctx) => {
  try {
    console.log(`Ejecutando el comando denegaracceso por el usuario ${ctx.from.username} (${ctx.from.id}), en ${ctx.chat.type}`);
    if (ctx.from.id.toString() === process.env.OWNER_ID) {
      const userId = ctx.message.text.split(' ')[1];

      if (!userId) {
        ctx.reply('Por favor, ingresa el ID de usuario.');
        return;
      }

      const existe = await usuarioExiste(userId);

      console.log(`Verificando si el usuario con ID ${userId} existe: ${existe}`);

      if (!existe) {
        ctx.reply(`El usuario con ID ${userId} no existe en la tabla, por lo que no se puede eliminar.`);
      } else {
        await eliminarUsuario(userId);
        ctx.reply(`Acceso denegado al usuario con ID ${userId}.`);
        console.log(`Acceso denegado al usuario con ID ${userId}.`);
      }
    } else {
      ctx.reply('No tienes permiso para ejecutar este comando.');
      console.log(`El usuario ${ctx.from.username} (${ctx.from.id}) intentó ejecutar el comando denegaracceso pero no tiene permisos.`);
    }
  } catch (error) {
    console.error(`Error al ejecutar el comando denegaracceso por el usuario ${ctx.from.username} (${ctx.from.id}):`, error);
  }
});


bot.launch();