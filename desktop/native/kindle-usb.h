#ifndef BOOKSTR_KINDLE_USB_H
#define BOOKSTR_KINDLE_USB_H

#include <libmtp.h>
#include <libusb.h>
#include <stdlib.h>

/* Descriptor enumeration must never open a USB handle. libmtp's global
 * detection probes unknown devices before callers can filter their vendor. */
static int kindle_raw_devices(LIBMTP_raw_device_t **devices, int *count) {
  *devices = NULL;
  *count = 0;
  libusb_context *context = NULL;
  if (libusb_init(&context) != 0) return -1;
  libusb_device **usb = NULL;
  ssize_t length = libusb_get_device_list(context, &usb);
  if (length < 0) { libusb_exit(context); return -1; }
  if (length == 0) {
    libusb_free_device_list(usb, 1);
    libusb_exit(context);
    return 0;
  }
  LIBMTP_raw_device_t *result = calloc((size_t)length, sizeof(*result));
  LIBMTP_device_entry_t *supported = NULL;
  int supported_count = 0;
  if (!result || LIBMTP_Get_Supported_Devices_List(&supported, &supported_count) != 0) {
    free(result);
    libusb_free_device_list(usb, 1);
    libusb_exit(context);
    return -1;
  }
  for (ssize_t i = 0; i < length; ++i) {
    struct libusb_device_descriptor descriptor;
    if (libusb_get_device_descriptor(usb[i], &descriptor) != 0 || descriptor.idVendor != 0x1949) continue;
    LIBMTP_device_entry_t entry = { .vendor = "Amazon", .vendor_id = 0x1949,
      .product = "Kindle", .product_id = descriptor.idProduct, .device_flags = 0 };
    int known = 0;
    for (int j = 0; j < supported_count; ++j) {
      if (supported[j].vendor_id == descriptor.idVendor && supported[j].product_id == descriptor.idProduct) {
        entry = supported[j];
        known = 1;
        break;
      }
    }
    if (!known) {
      int mtp = 0;
      for (uint8_t configuration = 0; configuration < descriptor.bNumConfigurations; ++configuration) {
        struct libusb_config_descriptor *config = NULL;
        if (libusb_get_config_descriptor(usb[i], configuration, &config) != 0) continue;
        for (uint8_t interface = 0; interface < config->bNumInterfaces; ++interface) {
          const struct libusb_interface *alternates = &config->interface[interface];
          for (int alternate = 0; alternate < alternates->num_altsetting; ++alternate) {
            const struct libusb_interface_descriptor *candidate = &alternates->altsetting[alternate];
            if (candidate->bInterfaceClass == LIBUSB_CLASS_IMAGE && candidate->bInterfaceSubClass == 1
                && candidate->bInterfaceProtocol == 1) mtp = 1;
          }
        }
        libusb_free_config_descriptor(config);
      }
      if (!mtp) continue;
    }
    result[*count].device_entry = entry;
    result[*count].bus_location = libusb_get_bus_number(usb[i]);
    result[*count].devnum = libusb_get_device_address(usb[i]);
    ++*count;
  }
  libusb_free_device_list(usb, 1);
  libusb_exit(context);
  *devices = result;
  return 0;
}

#endif
