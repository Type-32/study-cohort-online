import { z } from "zod";

// zod probes `new Function` to enable its JIT; the CSP forbids eval, so every page logged a
// blocked-eval violation. Its non-JIT path is what ran anyway.
z.config({ jitless: true });

export default defineNuxtPlugin(() => {});
