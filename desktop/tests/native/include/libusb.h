#ifndef KINDLE_TEST_LIBUSB_H
#define KINDLE_TEST_LIBUSB_H

#include <stdint.h>
#include <sys/types.h>

#define LIBUSB_CLASS_IMAGE 6

typedef struct libusb_context libusb_context;
typedef struct libusb_device libusb_device;

struct libusb_device_descriptor {
  uint16_t idVendor;
  uint16_t idProduct;
  uint8_t bDeviceClass;
  uint8_t bNumConfigurations;
};

struct libusb_interface_descriptor {
  uint8_t bInterfaceClass;
  uint8_t bInterfaceSubClass;
  uint8_t bInterfaceProtocol;
};

struct libusb_interface {
  const struct libusb_interface_descriptor *altsetting;
  int num_altsetting;
};

struct libusb_config_descriptor {
  uint8_t bNumInterfaces;
  const struct libusb_interface *interface;
};

int libusb_init(libusb_context **context);
ssize_t libusb_get_device_list(libusb_context *context, libusb_device ***devices);
int libusb_get_device_descriptor(libusb_device *device, struct libusb_device_descriptor *descriptor);
int libusb_get_config_descriptor(libusb_device *device, uint8_t index, struct libusb_config_descriptor **config);
void libusb_free_config_descriptor(struct libusb_config_descriptor *config);
uint8_t libusb_get_bus_number(libusb_device *device);
uint8_t libusb_get_device_address(libusb_device *device);
void libusb_free_device_list(libusb_device **devices, int unref_devices);
void libusb_exit(libusb_context *context);

#endif
