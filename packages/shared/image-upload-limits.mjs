/** Inclusive raw-image upload limit shared by browser and server.
 * Not a decoder, derivative/model budget, or processing authorization.
 * Processor EOF sentinel limits are a separate server adapter concern. */
export const IMAGE_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
