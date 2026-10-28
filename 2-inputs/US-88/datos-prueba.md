# Datos de prueba — US-88 (Quick Event SIDERA)

El runner lee este archivo al generar el script de pruebas. Rellena los valores reales del ambiente QA.
Cada caso que dependa de un dato vacío seguirá bloqueado (BLOCKED) con el motivo correspondiente.
No escribas contraseñas aquí: van en `.env` o en la sesión guardada desde qa-runner.html.

## Usuarios
- Comprador (sesión guardada en el runner): _pendiente_
- Proveedor: email en `.env` como `SIDERA_PROVIDER_EMAIL` y contraseña como `SIDERA_PROVIDER_PASSWORD`.

## Solicitudes de pedido (solped) en SAP QA
- Solped sin evento (SC_001, SC_003, SC_005, SC_011): _pendiente_
- Solped con evento (SC_005): _pendiente_
- Solped inexistente confirmada por negocio (SC_009): _pendiente_
- Atributos buscables de la solped de prueba (SC_008): _pendiente_

## Eventos
- Quick event abierto para el proveedor (SC_015–SC_017): _pendiente_
- Quick event vencido (SC_020): _pendiente_
- Evento sin adjudicación (SC_030): _pendiente_

## Cotización
- Datos válidos de cotización del proveedor (SC_016): _pendiente_

## Orden firmada
- Archivo válido de orden firmada (ruta dentro de `2-inputs/US-88/`) (SC_031): _pendiente_
- Archivo no válido para el caso negativo (SC_032): _pendiente_

## Integraciones externas
- Buzón para leer el correo de invitación (SC_013, SC_014): _pendiente_ (sin buzón, estos casos quedan como BLOCKED/MAILBOX)
- Forma de verificar la orden en SAP QA (SC_033): _pendiente_ (sin acceso, queda como BLOCKED/SAP_ACCESS)
