import 'package:cafe_dos/data/product_availability.dart';
import 'package:cafe_dos/data/hub_client.dart';
import 'package:cafe_dos/data/staff_recovery.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('legacy and current products have safe availability defaults', () {
    expect(validProductAvailability({'id': 'latte'}), isTrue);
    expect(productIsAvailable({'id': 'latte'}), isTrue);
    expect(
      validProductAvailability({
        'id': 'latte',
        'available': false,
        'availabilityVersion': 2,
      }),
      isTrue,
    );
    expect(
      productIsAvailable({
        'id': 'latte',
        'available': false,
        'availabilityVersion': 2,
      }),
      isFalse,
    );
    expect(
      validProductAvailability({'id': 'latte', 'available': false}),
      isFalse,
    );
    expect(
      validProductAvailability({
        'id': 'latte',
        'available': 'false',
        'availabilityVersion': 1,
      }),
      isFalse,
    );
    expect(
      validProductAvailability({
        'id': 'latte',
        'available': true,
        'availabilityVersion': 0,
      }),
      isFalse,
    );
  });

  test('unavailable lines match the order and reject injected fields', () {
    final line = {'lineNo': 0, 'productId': 'latte', 'name': 'Fixture latte'};
    final order = {
      'released': false,
      'cancelled': false,
      'lines': [line],
    };
    expect(validUnavailableLines(order), isTrue);
    expect(
      validUnavailableLines({
        ...order,
        'unavailableLines': [line],
      }),
      isTrue,
    );
    expect(
      validUnavailableLines({
        ...order,
        'unavailableLines': [line, line],
      }),
      isFalse,
    );
    expect(
      validUnavailableLines({
        ...order,
        'unavailableLines': [
          {...line, 'productId': 'other'},
        ],
      }),
      isFalse,
    );
    expect(
      validUnavailableLines({
        ...order,
        'unavailableLines': [
          {...line, 'costCentavos': 5},
        ],
      }),
      isFalse,
    );
    expect(
      validUnavailableLines({
        ...order,
        'released': true,
        'unavailableLines': [line],
      }),
      isFalse,
    );
    expect(
      validUnavailableLines({...order, 'unavailableLines': null}),
      isFalse,
    );
  });

  test('replacement route survives the durable recovery journal', () {
    final command = PendingStaffCommand(
      commandId: '01234567-89ab-4cde-8fab-0123456789ab',
      label: 'Replacement',
      hubOrigin: Uri.parse('https://cafe.example'),
      deviceId: 'tablet',
      actorId: 'cashier',
      branchId: 'branch',
      role: HubRole.cashier,
      path: '/api/v1/orders/order-1/replace-unavailable',
      payload: {'lineNo': 0, 'productId': 'espresso', 'reason': 'Unavailable'},
      expectedVersion: 1,
      createdAt: 1,
    );
    expect(command.businessAction, 'order.replace-unavailable');
  });

  test(
    'resolveCartLineProduct applies size, milk substitution, extra shots and dine-in vs takeout packaging',
    () {
      final product = <String, dynamic>{
        'id': 'latte',
        'name': 'Cafe Latte',
        'priceCentavos': 15000,
        'recipe': [
          {'ingredientId': 'beans', 'quantityMilli': 18000},
          {'ingredientId': 'whole-milk', 'quantityMilli': 180000},
        ],
        'options': {
          'sizes': [
            {
              'id': 'large',
              'name': '16oz Large',
              'priceDeltaCentavos': 3000,
              'recipe': [
                {'ingredientId': 'beans', 'quantityMilli': 24000},
                {'ingredientId': 'whole-milk', 'quantityMilli': 240000},
              ],
            },
          ],
          'substitutions': [
            {
              'id': 'sub-oat',
              'name': 'Oat Milk',
              'priceDeltaCentavos': 2500,
              'replaceIngredientId': 'whole-milk',
              'withIngredientId': 'oat-milk',
              'quantityMilli': 240000,
            },
          ],
          'addons': [
            {
              'id': 'extra-shot',
              'name': 'Extra Shot',
              'priceDeltaCentavos': 2000,
              'recipe': [
                {'ingredientId': 'beans', 'quantityMilli': 9000},
              ],
            },
          ],
          'dineInPackaging': [
            {'ingredientId': 'sleeve', 'quantityMilli': 1000},
          ],
          'takeoutPackaging': [
            {'ingredientId': 'to-go-cup', 'quantityMilli': 1000},
          ],
        },
      };

      final dineIn = resolveCartLineProduct(
        product,
        dineIn: true,
        sizeId: 'large',
        substitutionId: 'sub-oat',
        addons: const {'extra-shot': 2},
      );
      expect(dineIn['priceCentavos'], 24500);
      expect(dineIn['recipe'], [
        {'ingredientId': 'beans', 'quantityMilli': 42000},
        {'ingredientId': 'oat-milk', 'quantityMilli': 240000},
        {'ingredientId': 'sleeve', 'quantityMilli': 1000},
      ]);

      final takeout = resolveCartLineProduct(product, dineIn: false);
      expect(takeout['priceCentavos'], 15000);
      expect(takeout['recipe'], [
        {'ingredientId': 'beans', 'quantityMilli': 18000},
        {'ingredientId': 'to-go-cup', 'quantityMilli': 1000},
        {'ingredientId': 'whole-milk', 'quantityMilli': 180000},
      ]);
    },
  );

  test('customer and loyalty routes survive the durable recovery journal', () {
    PendingStaffCommand cmd(String path, Map<String, dynamic> payload) =>
        PendingStaffCommand(
          commandId: '01234567-89ab-4cde-8fab-0123456789ab',
          label: 'Loyalty',
          hubOrigin: Uri.parse('https://cafe.example'),
          deviceId: 'tablet',
          actorId: 'cashier',
          branchId: 'branch',
          role: HubRole.cashier,
          path: path,
          payload: payload,
          expectedVersion: 1,
          createdAt: 1,
        );

    expect(
      cmd('/api/v1/customers', {'displayName': 'Ada'}).businessAction,
      'customer.create',
    );
    expect(
      cmd('/api/v1/orders/order-1/customer', {'customerId': 'cust-1'})
          .businessAction,
      'order.customer.set',
    );
    expect(
      cmd('/api/v1/orders/order-1/loyalty/redeem-request', {
        'points': 10,
        'reason': 'Reward',
      }).businessAction,
      'loyalty.redeem.request',
    );
    expect(
      cmd('/api/v1/loyalty/redemptions/red-1/validate-cloud', {}).businessAction,
      'loyalty.redeem.validate-cloud',
    );
    expect(cmd('/api/v1/loyalty/sync', {}).businessAction, 'loyalty.sync');
  });
}
