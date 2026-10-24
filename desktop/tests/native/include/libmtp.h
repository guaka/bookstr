#ifndef KINDLE_TEST_LIBMTP_H
#define KINDLE_TEST_LIBMTP_H

#include <stdint.h>

typedef struct {
  char *vendor;
  uint16_t vendor_id;
  char *product;
  uint16_t product_id;
  uint32_t device_flags;
} LIBMTP_device_entry_t;

typedef struct {
  LIBMTP_device_entry_t device_entry;
  uint32_t bus_location;
  uint8_t devnum;
} LIBMTP_raw_device_t;

int LIBMTP_Get_Supported_Devices_List(LIBMTP_device_entry_t **devices, int *count);

#endif
