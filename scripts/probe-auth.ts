/** Non-spending auth probe: reads a fake job id and prints the error shape (never the key). */
import { ComfyError } from "@comfyorg/sdk";
import { getComfy } from "../lib/comfy";

async function main() {
  const key = process.env.COMFY_API_KEY ?? "";
  console.log(`key present: ${key.trim().length > 0}, prefix ok (comfyui-): ${key.trim().startsWith("comfyui-")}, length: ${key.trim().length}`);
  try {
    await getComfy().jobs.get("00000000-0000-4000-8000-000000000000");
    console.log("jobs.get: unexpected success");
  } catch (err) {
    if (err instanceof ComfyError)
      console.log(`jobs.get -> ${err.constructor.name} http=${err.httpStatus} code=${err.code} msg=${err.message} details=${JSON.stringify(err.details)}`);
    else console.log("jobs.get ->", err);
  }
}
main();
