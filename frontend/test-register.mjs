// Registra el resolve hook de tests (ver test-hooks.mjs). Se carga con
// `node --test --import ./test-register.mjs`.
import { register } from "node:module";

register("./test-hooks.mjs", import.meta.url);
