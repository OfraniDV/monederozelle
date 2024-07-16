// commands/comandos.js

const comandos = [
    {
      nombre: 'crearcuenta',
      descripcion: 'Crear una nueva cuenta.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/crearcuenta'
    },
    {
      nombre: 'miscuentas',
      descripcion: 'Listar todas tus cuentas.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/miscuentas'
    },
    {
      nombre: 'eliminarcuenta',
      descripcion: 'Eliminar una cuenta existente.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/eliminarcuenta'
    },
    {
      nombre: 'credito',
      descripcion: 'Agregar crédito a una cuenta.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/credito'
    },
    {
      nombre: 'debito',
      descripcion: 'Agregar débito a una cuenta.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/debito'
    },
    {
      nombre: 'resumen',
      descripcion: 'Obtener un resumen de una cuenta.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/resumen'
    },
    {
      nombre: 'resumentotal',
      descripcion: 'Obtener un resumen total de todas las cuentas.',
      permiso: 'Propietario o usuario con acceso',
      uso: '/resumentotal'
    },
    {
      nombre: 'daracceso',
      descripcion: 'Dar acceso a un usuario.',
      permiso: 'Solo propietario',
      uso: '/daracceso <user_id>'
    },
    {
      nombre: 'denegaracceso',
      descripcion: 'Revocar acceso de un usuario.',
      permiso: 'Solo propietario',
      uso: '/denegaracceso <user_id>'
    }
  ];
  
  module.exports = comandos;
  