// Observable toast sink; no React toast host is needed by the effects fixture.
export const toast = (message:unknown,options?:unknown) => {
  const host=globalThis as typeof globalThis & {powerTestToasts?:unknown[]};
  (host.powerTestToasts??=[]).push({message,options});
};
