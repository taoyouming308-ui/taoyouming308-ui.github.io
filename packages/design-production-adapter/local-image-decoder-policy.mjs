/** Resource boundary only, not customer authorization or decoder qualification.
 * Fixed imgproxy 3.8.0 hardLimitReader needs one EOF probe byte. The accepted
 * upload limit is unchanged; the probe must never become a client allowance. */
import {IMAGE_UPLOAD_MAX_BYTES} from '../shared/image-upload-limits.mjs';
export const LOCAL_IMAGE_DECODER_POLICY=Object.freeze({
 schemaVersion:'design-local-image-byte-policy-v1',
 decoderImage:'public.ecr.aws/supabase/imgproxy@sha256:0facd355d50f3be665ebe674486f2b2e9cdaebd3f74404acd9b7fece2f661435',
 decoderVersion:'3.8.0',maxAcceptedSourceBytes:IMAGE_UPLOAD_MAX_BYTES,
 decoderReadLimitBytes:IMAGE_UPLOAD_MAX_BYTES+1,acceptance:'inclusive',
 maxSourcePixels:40000000,productionEnabled:false
});
export function assertLocalImageSourceByteLength(value){
 const code=!Number.isSafeInteger(value)||value<1?'MANAGED_FILE_INVALID':value>IMAGE_UPLOAD_MAX_BYTES?'MANAGED_FILE_TOO_LARGE':null;
 if(code)throw Object.assign(new Error(code),{code,outcome:'not_sent',retryable:false});
 return value;
}
