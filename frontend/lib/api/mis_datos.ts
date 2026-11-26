// Dominio Mis datos del API (Fase 2 mejoras-v1, tarea 4): exportar los
// datos propios (JSON) y borrar la propia cuenta (con contraseña).
import { request } from "./client";

export const misDatosApi = {
  // GET /api/mis-datos/exportar: el backend responde el JSON con
  // Content-Disposition attachment; el componente construye el Blob y
  // la descarga con el nombre del archivo.
  exportMyData: () => request<Record<string, unknown>>("/api/mis-datos/exportar", { auth: true }),
  // DELETE /api/mis-datos/cuenta: 401 con clave incorrecta, 400 si es
  // la última cuenta super admin o administradora, 403 desde invitado.
  // Tras el éxito el token ya no vale: hay que cerrar sesión.
  deleteMyAccount: (password: string) =>
    request<{ ok: boolean }>("/api/mis-datos/cuenta", {
      method: "DELETE",
      auth: true,
      body: { password },
    }),
};
