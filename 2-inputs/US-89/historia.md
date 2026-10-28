# US-89 - Test-IA Regresión Bodeguita

## Descripción

Validar que las funcionalidades principales del servicio de Bodeguita en Odoo continúen operando correctamente después de los cambios realizados, asegurando que no existan regresiones en los procesos existentes.

## Criterios de aceptación

CA-01 — Acceso al servicio 
  El usuario con los permisos correspondientes debe poder acceder al módulo/funcionalidad de Bodeguita. Las opciones disponibles deben corresponder al perfil y permisos del usuario. 
 No deben presentarse errores al ingresar al servicio. 
  CA-02 — Creación de un servicio de Bodeguita 
El usuario debe poder crear correctamente un nuevo servicio de Bodeguita. 
 Los campos obligatorios deben estar identificados y validarse correctamente. 
 La información ingresada debe guardarse sin errores. 
 El registro creado debe quedar disponible para su consulta posterior. 
  CA-03 — Consulta de servicios 
El usuario debe poder consultar los servicios de Bodeguita previamente registrados. 
 La información mostrada debe corresponder al registro almacenado. 
 Los filtros y búsquedas disponibles deben funcionar correctamente. 
  CA-04 — Actualización del servicio 
El usuario debe poder modificar la información permitida de un servicio existente. 
 Los cambios deben guardarse correctamente. 
 La información actualizada debe reflejarse en las diferentes vistas relacionadas con el servicio. 
  CA-05 — Gestión de estados 
El servicio debe poder avanzar por los estados definidos para el proceso de Bodeguita. 
 Cada cambio de estado debe registrarse correctamente. 
 El sistema no debe permitir transiciones no autorizadas o inconsistentes. 
 El estado mostrado debe ser consistente en las pantallas relacionadas. 
  CA-06 — Registro y gestión de artículos 
El usuario debe poder registrar los artículos asociados al servicio de Bodeguita. 
 La información de los artículos debe almacenarse correctamente. 
 Las cantidades, descripciones y demás datos configurados deben mantenerse sin alteraciones no esperadas. 
  CA-07 — Inventario / disponibilidad 
Las operaciones relacionadas con inventario deben ejecutarse correctamente cuando correspondan al flujo de Bodeguita. 
 Las cantidades y movimientos generados deben ser consistentes con la operación realizada. 
 No deben generarse movimientos duplicados o inconsistentes. 
  CA-08 — Cobro / facturación 
Cuando el flujo de Bodeguita requiera un cobro o facturación, el proceso debe completarse correctamente. 
 Los importes calculados deben corresponder a la configuración vigente. 
 El documento generado debe quedar correctamente relacionado con el servicio. 
 No deben generarse cargos o documentos duplicados. 
  CA-09 — Integración con clientes 
El servicio debe poder asociarse correctamente al cliente correspondiente. 
 La información del cliente debe mostrarse correctamente durante el proceso. 
 Las operaciones realizadas sobre Bodeguita no deben modificar información del cliente de forma no esperada. 
  CA-10 — Entrega / cierre del servicio 
El usuario debe poder completar el flujo de entrega o cierre de Bodeguita según el proceso definido. 
 El sistema debe actualizar correctamente el estado final. 
 La información del servicio debe permanecer disponible para consulta después de completado. 
  CA-11 — Validaciones y manejo de errores 
Los campos obligatorios deben impedir el procesamiento cuando no hayan sido completados. 
 El sistema debe mostrar mensajes claros ante información inválida. 
 Los errores no deben provocar pérdida o duplicación de información. 
  CA-12 — Permisos y roles 
Cada perfil debe tener acceso únicamente a las funcionalidades autorizadas. 
 Los usuarios sin permisos no deben poder ejecutar acciones restringidas. 
 Los permisos existentes deben mantenerse después de los cambios realizados. 
  CA-13 — Búsqueda, filtros y vistas 
Las vistas utilizadas para gestionar Bodeguita deben cargar correctamente. 
 Las búsquedas y filtros deben devolver la información correspondiente. 
 La información presentada en las vistas debe ser consistente con los registros almacenados. 
  CA-14 — Notificaciones / comunicaciones 
Las notificaciones o comunicaciones asociadas al proceso deben generarse correctamente cuando correspondan. 
 La información enviada debe corresponder al servicio procesado. 
 No deben generarse notificaciones duplicadas. 
  CA-15 — Regresión de funcionalidades existentes 
Las funcionalidades de Bodeguita que se encontraban operativas antes de los cambios deben continuar funcionando correctamente. 
 Los cambios realizados no deben afectar otros procesos relacionados con Bodeguita. 
 Los registros existentes deben poder consultarse y procesarse sin pérdida de información. 
  CA-16 — Integridad de la información 
La información registrada durante el proceso debe mantenerse consistente entre las diferentes funcionalidades relacionadas. 
 Los datos no deben duplicarse, desaparecer o modificarse de manera inesperada. 
 Las relaciones entre cliente, servicio, artículos, inventario y facturación deben mantenerse correctamente cuando apliquen. 
  CA-17 — Flujo end-to-end 
Debe ser posible ejecutar un servicio de Bodeguita desde su creación hasta su cierre/entrega sin errores bloqueantes. 
 La información generada durante cada etapa debe estar disponible en las etapas posteriores. 
 El flujo completo debe finalizar con el estado y documentos correspondientes.

## Azure DevOps

- ID: 89
- Tipo: Task
- Estado: To Do
- Prioridad: 2
- Área: Pruebas-TI IA
- Iteración: Pruebas-TI IA
- URL: https://dev.azure.com/GSID-Autogestion/9a29ac17-af10-48ab-88cd-1a7193a3900a/_workitems/edit/89
- Última modificación: 2026-10-27T16:22:35.9Z

- URL de pruebas: https://bodeguitagsid-qa-39945453.dev.odoo.com/
