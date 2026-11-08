import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'hub_client_test.dart' as support;

const commandId = '01234567-89ab-4cde-8fab-0123456789ab';

void main() {
  test('a saved unavailable-product rejection can be reconciled', () async {
    final hub = HubClient(
      baseUri: Uri.parse('https://cafe.example'),
      client: MockClient((request) async {
        if (request.url.path.endsWith('/auth/staff')) {
          return support.jsonResponse(support.sessionBody());
        }
        return support.jsonResponse({
          'commandId': commandId,
          'status': 'rejected',
          'action': 'order.create',
          'rejectedAt': 1234,
          'error': {'code': 'product_unavailable', 'message': 'Unavailable'},
        });
      }),
    );
    addTearDown(hub.close);
    await support.staffLogin(hub);
    expect((await hub.commandStatus(commandId))['status'], 'rejected');
  });
  test(
    'replacement acknowledgment binds order, version and replacement line',
    () async {
      var responseOrder = <String, dynamic>{
        'id': support.orderId,
        'version': 3,
        'released': false,
        'cancelled': false,
        'unavailableLines': <Object>[],
        'lines': [
          {'lineNo': 3, 'productId': 'espresso', 'name': 'Espresso'},
        ],
      };
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return support.jsonResponse(support.sessionBody());
          }
          final payload = jsonDecode(request.body) as Map;
          return support.jsonResponse({
            'commandId': payload['commandId'],
            'order': responseOrder,
          });
        }),
      );
      addTearDown(hub.close);
      await support.staffLogin(hub);
      Future<Map<String, dynamic>> submit() => hub.mutate(
        '/api/v1/orders/${support.orderId}/replace-unavailable',
        commandId: commandId,
        expectedVersion: 2,
        payload: {
          'lineNo': 0,
          'productId': 'espresso',
          'reason': 'Unavailable',
        },
      );
      expect((await submit())['order']['version'], 3);
      for (final invalid in [
        {...responseOrder, 'id': 'wrong'},
        {...responseOrder, 'version': 4},
        {
          ...responseOrder,
          'lines': [
            {'lineNo': 0, 'productId': 'espresso'},
          ],
        },
        {
          ...responseOrder,
          'lines': [
            {'lineNo': 3, 'productId': 'other'},
          ],
        },
        {...responseOrder, 'unavailableLines': null},
      ]) {
        responseOrder = invalid;
        await expectLater(
          submit(),
          throwsA(
            isA<HubException>().having(
              (e) => e.outcomeUnknown,
              'outcomeUnknown',
              true,
            ),
          ),
        );
      }
    },
  );

  test(
    'legacy products are readable and malformed availability is rejected',
    () async {
      var product = <String, dynamic>{'id': 'espresso'};
      final hub = HubClient(
        baseUri: Uri.parse('https://cafe.example'),
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/staff')) {
            return support.jsonResponse(support.sessionBody());
          }
          return http.Response(
            jsonEncode({
              'products': [product],
            }),
            200,
          );
        }),
      );
      addTearDown(hub.close);
      await support.staffLogin(hub);
      expect(await hub.products(), [product]);
      product = {'id': 'espresso', 'available': false};
      await expectLater(hub.products(), throwsA(isA<HubException>()));
    },
  );
}
