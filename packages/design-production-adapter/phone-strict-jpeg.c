/* Full libjpeg decode with every warning fatal, including premature EOI.
 * Runs only within the same bounded, network-free native worker process. */
#include <stdio.h>
#include <stdlib.h>
#include <setjmp.h>
#include <string.h>
#include "jpeglib.h"
struct strict_error { struct jpeg_error_mgr base; jmp_buf jump; };
static void reject(j_common_ptr c) { longjmp(((struct strict_error *)c->err)->jump, 1); }
static void message(j_common_ptr c, int level) { if (level < 0) reject(c); }
int design_strict_jpeg(const unsigned char *data, unsigned long size) {
  struct jpeg_decompress_struct c;
  struct strict_error e;
  volatile int created = 0, accepted = 0;
  unsigned char * volatile row = NULL;
  memset(&c, 0, sizeof(c));
  c.err = jpeg_std_error(&e.base);
  e.base.error_exit = reject; e.base.emit_message = message;
  if (setjmp(e.jump)) goto done;
  jpeg_create_decompress(&c); created = 1;
  c.mem->max_memory_to_use = 67108864;
  jpeg_mem_src(&c, data, size);
  if (jpeg_read_header(&c, TRUE) != JPEG_HEADER_OK || !c.image_width || !c.image_height ||
      c.image_width > 16384 || c.image_height > 16384 ||
      (unsigned long long)c.image_width * c.image_height > 40000000) goto done;
  c.out_color_space = JCS_RGB;
  if (!jpeg_start_decompress(&c) || c.output_components != 3) goto done;
  row = malloc((size_t)c.output_width * 3);
  if (!row) goto done;
  while (c.output_scanline < c.output_height) {
    JSAMPROW rows[1] = {(unsigned char *)row};
    if (jpeg_read_scanlines(&c, rows, 1) != 1) goto done;
  }
  if (!jpeg_finish_decompress(&c) || c.err->num_warnings || c.src->bytes_in_buffer) goto done;
  accepted = 1;
done:
  if (row) free((void *)row);
  if (created) jpeg_destroy_decompress(&c);
  return accepted;
}
