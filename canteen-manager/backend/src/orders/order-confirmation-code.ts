// Display-only reassurance code shown to a visitor at the kiosk and echoed on the cashier
// queue row so staff can cross-check the visitor's slip. Derived from the order UUID — it is
// NOT stored and NOT a lookup key; the cashier matches the queue by prisoner name, which is
// unambiguous because at most one relative order is pending per prisoner+date.
export const confirmationCode = (orderId: string): string =>
  orderId.slice(0, 8).toUpperCase();
