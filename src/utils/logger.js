import { EventEmitter } from "events";

export const logEmitter = new EventEmitter();

export class Logger {
  constructor(moduleName) {
    this.moduleName = moduleName || "SYSTEM";
  }

  format(level, message, useColor = false) {
    const timestamp = new Date().toISOString();
    if (!useColor) {
      return `[${timestamp}] [${level}] [${this.moduleName}]: ${message}`;
    }

    let levelColor = "\x1b[32m"; // green for INFO
    if (level === "WARN") {
      levelColor = "\x1b[33m"; // yellow for WARN
    } else if (level === "ERROR") {
      levelColor = "\x1b[31m"; // red for ERROR
    }

    return `\x1b[90m[${timestamp}]\x1b[0m ${levelColor}[${level}]\x1b[0m \x1b[36m[${this.moduleName}]\x1b[0m: ${message}`;
  }

  info(message) {
    console.log(this.format("INFO", message, true));
    logEmitter.emit("log", this.format("INFO", message, false));
  }

  warn(message) {
    console.warn(this.format("WARN", message, true));
    logEmitter.emit("log", this.format("WARN", message, false));
  }

  error(message, errorStack = "") {
    console.error(this.format("ERROR", message, true));
    logEmitter.emit("log", this.format("ERROR", message, false));
    if (errorStack) {
      console.error(errorStack);
      logEmitter.emit("log", errorStack);
    }
  }
}
