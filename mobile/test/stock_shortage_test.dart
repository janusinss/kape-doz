import 'package:cafe_dos/data/stock_shortage.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'cart aggregates product and line quantities before subtracting reservations',
    () {
      final values = cartStockShortages(
        [
          (
            product: <String, dynamic>{
              'recipe': [
                {'ingredientId': 'beans', 'quantityMilli': 18000},
              ],
            },
            quantity: 1,
          ),
          (
            product: <String, dynamic>{
              'recipe': [
                {'ingredientId': 'beans', 'quantityMilli': 9000},
              ],
            },
            quantity: 2,
          ),
        ],
        [
          {
            'id': 'beans',
            'name': 'Espresso beans',
            'unit': 'g',
            'onHandMilli': 30000,
            'reservedMilli': 10000,
          },
        ],
      );
      expect(values.incomplete, isFalse);
      expect(values.shortages.length, 1);
      final value = values.shortages.single;
      expect(
        [value.requiredMilli, value.availableMilli, value.shortfallMilli],
        [36000, 20000, 16000],
      );
      expect(value.shortfallLabel, '16 g');
    },
  );

  test(
    'negative recorded stock produces its full shortfall without clamping availability',
    () {
      final values = cartStockShortages(
        [
          (
            product: <String, dynamic>{
              'recipe': [
                {'ingredientId': 'milk', 'quantityMilli': 150000},
              ],
            },
            quantity: 1,
          ),
        ],
        [
          {
            'id': 'milk',
            'name': 'Whole milk',
            'unit': 'ml',
            'onHandMilli': -1000,
            'reservedMilli': 2000,
          },
        ],
      );
      expect(values.shortages.single.availableMilli, -3000);
      expect(values.shortages.single.shortfallLabel, '153 ml');
    },
  );

  test(
    'fractional pieces retain three-decimal precision without trailing zeroes',
    () {
      const value = StockShortage(
        ingredientId: 'packaging',
        name: 'Packaging',
        unit: 'piece',
        requiredMilli: 1000,
        availableMilli: 750,
        shortfallMilli: 250,
      );
      expect(value.shortfallLabel, '0.25 piece');
    },
  );

  test(
    'sufficient stock and legacy catalogue records produce no invented warnings',
    () {
      final result = cartStockShortages(
        [
          (product: <String, dynamic>{}, quantity: 1),
          (
            product: <String, dynamic>{
              'recipe': [
                {'ingredientId': 'beans', 'quantityMilli': 18000},
              ],
            },
            quantity: 1,
          ),
        ],
        [
          {
            'id': 'beans',
            'name': 'Espresso beans',
            'unit': 'g',
            'onHandMilli': 20000,
            'reservedMilli': 2000,
          },
        ],
      );
      expect(result.shortages, isEmpty);
      expect(result.incomplete, isTrue);
      expect(orderStockShortages({'id': 'legacy'}), isEmpty);
    },
  );

  test(
    'missing or malformed ingredient data marks availability incomplete',
    () {
      final lines = [
        (
          product: <String, dynamic>{
            'recipe': [
              {'ingredientId': 'beans', 'quantityMilli': 18000},
            ],
          },
          quantity: 1,
        ),
      ];
      expect(cartStockShortages(lines, []).incomplete, isTrue);
      expect(
        cartStockShortages(lines, [
          {
            'id': 'beans',
            'name': 'Beans',
            'unit': 'g',
            'onHandMilli': 'bad',
            'reservedMilli': 0,
          },
        ]).incomplete,
        isTrue,
      );
    },
  );

  test('safe integer edge differences are compared exactly', () {
    final item = {
      'ingredientId': 'beans',
      'name': 'Espresso beans',
      'unit': 'g',
      'requiredMilli': 9007199254740991,
      'availableMilli': 1,
      'shortfallMilli': 9007199254740990,
    };
    expect(
      validOrderStockShortages({
        'shortages': [item],
      }),
      isTrue,
    );
    expect(
      validOrderStockShortages({
        'shortages': [
          {...item, 'availableMilli': -1},
        ],
      }),
      isFalse,
    );
  });
}
