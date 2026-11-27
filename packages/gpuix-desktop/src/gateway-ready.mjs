import http from "node:http";

const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once("listening", () => {
    const address = this.address();
    if (address && typeof address === "object" && address.port === Number(process.env.PORT) && process.send) {
      process.send({ type: "gpuix-gateway-listening", port: address.port });
    }
  });
  return listen.apply(this, args);
};
