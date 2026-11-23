// Call only with a completed result from the existing authenticated read.
// A hint is not an account, a receipt, a permission check or a DB cursor.
import '../../../scoped-read-codec.js';
export async function encodeReadSync(hint, result) {
  if (!hint) return result;
  try {return await globalThis.ZysyrReadCodec.encode(hint, result);}
  catch {return result;} // Optional transport optimization; ordinary reads still work.
}
