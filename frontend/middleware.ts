// Middleware de rutas protegidas (Fase 4, FE1) — paso deliberadamente
// pasivo, NO un gate de autenticación.
//
// Por qué no redirige: el token vive en localStorage (`aci_token`), que el
// servidor no puede leer; un chequeo de presencia en middleware no vería
// nunca el token y redirigiría a /login a usuarios con sesión válida,
// rompiendo la app. El gate real sigue siendo el backend (require_admin en
// escrituras de control, verificado en auditoría) más el chequeo de
// presencia en cliente (ModuleShell + dashboard) que preserva ?next=.
//
// El chequeo de presencia en servidor queda pendiente de la migración a
// cookie httpOnly vía route handler, que exige cambios de backend y es un
// seguimiento explícito de esta fase — no se implementa aquí para no tocar
// el flujo de auth. Este archivo existe como punto único donde vivirá ese
// gate cuando la cookie exista, con el matcher ya acotado a rutas de app.
import { NextResponse } from "next/server";

export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|_next/static|_next/image|favicon.ico|sounds|.*\\.(?:png|jpg|jpeg|svg|mp3|ico)$).*)",
  ],
};
