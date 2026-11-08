# First-slice domain contract

Scope: pure Dart module at `mobile/lib/domain/cafe_engine.dart`. UI-framework state and real device/cloud transports are outside this core. No production code is authored by the TDD role.

## Public interface

```dart
class Product {
  String get id;
  String get name;
  int get priceCentavos;
  Map<String, int> get recipe;
}

class CafeOrder {
  String get id;
  String get productId;
  int get quantity;
  bool get dineIn;
  int get totalCentavos;
  int get paidCentavos; // confirmed allocations only
  bool get released;
  bool get ready;
}

class CafeEngine {
  CafeEngine.sample();
  factory CafeEngine.fromJson(Map<String, dynamic> json);
  List<Product> get products;
  List<CafeOrder> get orders;
  Map<String, int> get stock;
  Map<String, int> get reservations;
  CafeOrder createOrder({required String productId,
    required int quantity, required bool dineIn});
  void sendOrder(String orderId);
  void addPayment(String orderId, {required int amountCentavos,
    required String method, required bool verified});
  void markReady(String orderId);
  void logWaste(String ingredientId, int quantity);
  Map<String, dynamic> toJson();
  Map<String, dynamic> staffSnapshot();
}
```

Getters may be final fields, provided the signatures and observable behavior hold. Tests re-read an order through `engine.orders` after mutations; callers need not rely on mutable object identity.

## Fixture

The fixture includes product `spanish-latte`, name `Iced Spanish Latte`, price 16500 centavos, with canonical integer base-unit recipe `{beans: 18, milk: 150, syrup: 15, cup: 1, lid: 1}`. Beans are grams, liquids are milliliters and packaging is pieces. Initial stock must cover at least three fixture drinks. The fixture is sample data, not the client's actual menu/stock.

## Command rules

1. `createOrder` rejects unknown products and nonpositive quantities with `ArgumentError`. New orders have zero confirmed payment and no release/ready state. IDs are unique across serialization/restart.
2. `sendOrder` explicitly releases a dine-in order once. An unpaid takeout order rejects release with `StateError`. Fully paid takeout releases automatically. Release reserves recipe quantities but does not change on-hand stock. Repeated send is harmless.
3. `addPayment` accepts only `cash`, `gcash`, and `card`, in positive integer centavos. Cash is confirmed locally. External tenders count toward payment only when `verified` is true. Pending external allocations may be recorded but cannot release takeout. Over-confirming the payable total rejects with `StateError` without changing confirmed amounts. Unsupported methods/nonpositive amounts reject with `ArgumentError`. Successful full payment releases an unreleased order once; existing releases are not duplicated. For this first slice, confirming an external payment is a new confirmed allocation; pending payment replacement/reconciliation belongs to a later tender-ID contract.
4. `markReady` requires release or throws `StateError`. On first success, consume captured recipe times quantity, release those reservations, and mark ready in one in-memory command boundary. Repeated ready is harmless. Negative resulting stock is permitted under the selected warn-and-continue policy. Durable database atomicity is implemented by the repository layer, not proven by these pure tests.
5. `logWaste` accepts an existing ingredient and a positive integer base-unit amount, deducts stock and leaves orders/revenue untouched. Invalid input rejects with `ArgumentError`. Negative stock is permitted.
6. Unknown order IDs reject with `ArgumentError` for commands, without side effects.
7. `toJson` emits JSON-encodable state; `fromJson` restores stock, reservations, orders, confirmed tender totals, release/ready flags and future ID generation. Restoring must not replay consumption. Malformed persistence validation is required before production; first tests cover valid round trips.

## Staff data boundary

`staffSnapshot` returns exactly the top-level keys `products`, `orders`, `stock`, and `reservations`. Product entries contain only `id`, `name`, `priceCentavos`, and `recipe`. Order entries contain only `id`, `productId`, `quantity`, `dineIn`, `totalCentavos`, `paidCentavos`, `released`, and `ready`. Each entry is a JSON-encodable map.

No purchase costs, production costs, margins, profits, OPEX, expected cash or cash variance are present. This core does not enforce authentication; the snapshot is an explicit positive projection whose actual local/cloud endpoint authorization still needs implementation. If the domain later gains privileged fields, this projection must remain explicit rather than serializing the entire object.

## Test execution

After the root agent creates the Flutter project and dependencies are available, run `flutter test test/domain_test.dart` from `mobile/`. The expected initial failure is missing `lib/domain/cafe_engine.dart`; implementation must then satisfy the behavioral tests. No test run or native capability claim is made by merely writing this contract.
