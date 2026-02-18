// commands/comandos.js

const comandos = [
  {
    nombre: 'start',
    descripcion: 'Abre el menú principal inline con accesos rápidos a asistentes.',
    permiso: 'Cualquiera',
    uso: '/start'
  },
  {
    nombre: 'ping',
    descripcion: 'Comprueba la latencia y salud del bot.',
    permiso: 'Cualquiera',
    uso: '/ping'
  },
  {
    nombre: 'crearcuenta',
    descripcion: 'Crear una nueva cuenta en el sistema legacy.',
    permiso: 'Propietario o usuario con acceso',
    uso: '/crearcuenta'
  },
  {
    nombre: 'miscuentas',
    descripcion: 'Listar todas tus cuentas existentes (legacy).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/miscuentas'
  },
  {
    nombre: 'eliminarcuenta',
    descripcion: 'Eliminar una cuenta existente (legacy).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/eliminarcuenta'
  },
  {
    nombre: 'credito',
    descripcion: 'Agregar crédito a una cuenta (legacy).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/credito <alias> <monto> [descripcion]'
  },
  {
    nombre: 'debito',
    descripcion: 'Agregar débito a una cuenta (legacy).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/debito <alias> <monto> [descripcion]'
  },
  {
    nombre: 'resumen',
    descripcion: 'Obtener un resumen de una cuenta específica (legacy).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/resumen <alias>'
  },
  {
    nombre: 'resumentotal',
    descripcion: 'Obtener un resumen consolidado de todas las cuentas (legacy).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/resumentotal'
  },
  {
    nombre: 'monedas',
    descripcion: 'Listar, crear, editar o eliminar monedas (multi-moneda).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/monedas'
  },
  {
    nombre: 'bancos',
    descripcion: 'Listar, crear, editar o eliminar bancos con emoji y código.',
    permiso: 'Propietario o usuario con acceso',
    uso: '/bancos'
  },
  {
    nombre: 'agentes',
    descripcion: 'Listar, crear, editar o eliminar agentes/dueños de tarjetas.',
    permiso: 'Propietario o usuario con acceso',
    uso: '/agentes'
  },
  {
    nombre: 'tarjeta',
    descripcion: 'Iniciar wizard para crear o actualizar una tarjeta/subcuenta (asignar agente, banco, moneda y saldo inicial).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/tarjeta'
  },
  {
    nombre: 'tarjetas',
    descripcion: 'Listar todas las tarjetas existentes con su saldo actual y atributos (agente, banco, moneda). El menú principal se muestra en forma de lista y los agentes se muestran en filas de dos.',
    permiso: 'Propietario o usuario con acceso',
    uso: '/tarjetas'
  },
  {
    nombre: 'saldo',
    descripcion: 'Actualizar el saldo actual de una tarjeta y registrar movimiento con delta (aumento/disminución).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/saldo'
  },
  {
    nombre: 'monitor',
    descripcion: 'Comparar salud financiera: periodo actual vs anterior (día/mes/año) con filtros de moneda, agente y banco. Cada menú incluye la opción "Todos" para ver un resumen global.',
    permiso: 'Propietario o usuario con acceso',
    uso: '/monitor [dia|mes|año]'
  },
  {
    nombre: 'extracto',
    descripcion:
      'Ver un extracto bancario por tarjeta basado en los movimientos registrados. Permite filtrar por agente o banco y escoger periodo (día, semana, mes).',
    permiso: 'Propietario o usuario con acceso',
    uso: '/extracto'
  },
  {
    nombre: 'acceso',
    descripcion: 'Asistente para gestionar usuarios con acceso (agregar o eliminar).',
    permiso: 'Solo propietario',
    uso: '/acceso'
  }
];

module.exports = comandos;
