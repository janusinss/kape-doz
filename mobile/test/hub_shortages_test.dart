import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';

import 'hub_client_test.dart' as support;

Map<String, dynamic> _shortage() => {
  'ingredientId': 'beans',
  'name': 'Espresso beans',
  'unit': 'g',
  'requiredMilli': 18000,
  'availableMilli': 10000,
  'shortfallMilli': 8000,
};

HubClient _client(Map<String, dynamic> order) => HubClient(
  baseUri: Uri.parse('https://cafe.example'),
  client: MockClient((request) async {
    if (request.url.path.endsWith('/auth/staff')) {
      return support.jsonResponse(support.sessionBody());
    }
    return support.jsonResponse(
      request.url.path == '/api/v1/orders'
          ? {
              'orders': [order],
            }
          : {'order': order},
    );
  }),
);

void main() {
  test(
    'valid shortage quantities and missing legacy shortages remain readable',
    () async {
      for (final extra in [
        <String, dynamic>{},
        {'shortages': <Object>[]},
        {
          'shortages': [_shortage()],
        },
        {
          'shortages': [
            {..._shortage(), 'availableMilli': -1000, 'shortfallMilli': 19000},
          ],
        },
      ]) {
        final order = {'id': support.orderId, 'version': 1, ...extra};
        final hub = _client(order);
        addTearDown(hub.close);
        await support.staffLogin(hub);
        expect(await hub.orders(), [order]);
        expect(await hub.order(support.orderId), order);
      }
    },
  );

  final malformed = <String, Object?>{
    'null field': null,
    'non-list field': {},
    'non-record item': [null],
    'missing fields': [{}],
    'unknown cost field': [
      {..._shortage(), 'costCentavos': 800},
    ],
    'duplicate ingredient': [_shortage(), _shortage()],
    'invalid ingredient ID': [
      {..._shortage(), 'ingredientId': '../beans'},
    ],
    'empty ingredient name': [
      {..._shortage(), 'name': ' '},
    ],
    'long ingredient name': [
      {..._shortage(), 'name': 'a' * 121},
    ],
    'unknown unit': [
      {..._shortage(), 'unit': 'kg'},
    ],
    'fractional quantity': [
      {..._shortage(), 'requiredMilli': 18000.5},
    ],
    'string quantity': [
      {..._shortage(), 'requiredMilli': '18000'},
    ],
    'zero requirement': [
      {..._shortage(), 'requiredMilli': 0},
    ],
    'unsafe requirement': [
      {..._shortage(), 'requiredMilli': 9007199254740992},
    ],
    'unsafe availability': [
      {..._shortage(), 'availableMilli': -9007199254740992},
    ],
    'zero shortage': [
      {..._shortage(), 'shortfallMilli': 0},
    ],
    'wrong difference': [
      {..._shortage(), 'shortfallMilli': 7999},
    ],
    'difference exceeds safe integer': [
      {
        ..._shortage(),
        'requiredMilli': 9007199254740991,
        'availableMilli': -1,
        'shortfallMilli': 9007199254740991,
      },
    ],
  };
  for (final entry in malformed.entries) {
    test('present malformed shortages reject reads: ${entry.key}', () async {
      final hub = _client({'id': support.orderId, 'shortages': entry.value});
      addTearDown(hub.close);
      await support.staffLogin(hub);
      for (final read in [hub.orders, () => hub.order(support.orderId)]) {
        await expectLater(
          read(),
          throwsA(
            isA<HubException>()
                .having((e) => e.code, 'code', 'invalid_response')
                .having((e) => e.outcomeUnknown, 'unknown outcome', isFalse),
          ),
        );
      }
    });
  }

  for (final state in ['ready', 'cancelled']) {
    test('$state orders cannot carry active shortage warnings', () async {
      final hub = _client({
        'id': support.orderId,
        state: true,
        'shortages': [_shortage()],
      });
      addTearDown(hub.close);
      await support.staffLogin(hub);
      await expectLater(hub.orders(), throwsA(isA<HubException>()));
    });
  }

  for (final suffix in ['', '/send', '/ready', '/prepare', '/receipt']) {
    test(
      'malformed shortage acknowledgment keeps $suffix command uncertain',
      () async {
        var transmissions = 0;
        final hub = HubClient(
          baseUri: Uri.parse('https://cafe.example'),
          client: MockClient((request) async {
            if (request.url.path.endsWith('/auth/staff')) {
              return support.jsonResponse(support.sessionBody());
            }
            transmissions++;
            return support.jsonResponse({
              'commandId': support.commandId,
              'order': {
                'id': support.orderId,
                'version': 2,
                'preparing': true,
                'shortages': null,
              },
            });
          }),
        );
        addTearDown(hub.close);
        await support.staffLogin(hub);
        await expectLater(
          hub.mutate(
            suffix.isEmpty
                ? '/api/v1/orders'
                : '/api/v1/orders/${support.orderId}$suffix',
            commandId: support.commandId,
            expectedVersion: suffix.isEmpty ? null : 1,
          ),
          throwsA(
            isA<HubException>()
                .having((e) => e.code, 'code', 'invalid_response')
                .having((e) => e.outcomeUnknown, 'unknown outcome', isTrue),
          ),
        );
        expect(transmissions, 1);
      },
    );
  }

  test(
    'payment shortage validation preserves strict tender acknowledgment checks',
    () async {
      for (final bad in [false, true]) {
        final payment = support.tender(amount: 16500, status: 'confirmed');
        final hub = HubClient(
          baseUri: Uri.parse('https://cafe.example'),
          client: MockClient(
            (request) async => request.url.path.endsWith('/auth/staff')
                ? support.jsonResponse(support.sessionBody())
                : support.jsonResponse(
                    support.paymentAcknowledgment(
                      payment,
                      orderOverrides: {
                        'shortages': bad ? null : [_shortage()],
                      },
                    ),
                  ),
          ),
        );
        addTearDown(hub.close);
        await support.staffLogin(hub);
        final result = hub.addPayment(
          orderId: support.orderId,
          commandId: support.commandId,
          expectedVersion: 1,
          method: 'gcash',
          amountCentavos: 16500,
          verified: true,
          reference: 'MERCHANT-01',
        );
        if (bad) {
          await expectLater(
            result,
            throwsA(
              isA<HubException>().having(
                (e) => e.outcomeUnknown,
                'unknown outcome',
                isTrue,
              ),
            ),
          );
        } else {
          expect((await result)['payment'], payment);
        }
      }
    },
  );
}
