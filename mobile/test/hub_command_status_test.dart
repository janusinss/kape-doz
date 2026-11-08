import 'dart:convert';

import 'package:cafe_dos/data/hub_client.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const command = '12345678-1234-4123-8123-123456789abc';

void main() {
  Future<void> login(HubClient client) => client.loginStaff(
    accountId: 'cashier',
    pin: '4826',
    deviceId: 'tablet',
    deviceSecret: 'Fixture-device-secret-32-characters',
  );

  HubClient fixture(Object status, List<http.Request> requests) => HubClient(
    baseUri: Uri.parse('https://hub.example'),
    client: MockClient((request) async {
      requests.add(request);
      return http.Response(
        jsonEncode(
          request.url.path.endsWith('/auth/staff')
              ? {
                  'token': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                  'expiresAt': 4102444800000,
                  'actor': {
                    'id': 'cashier',
                    'branchId': 'branch',
                    'displayName': 'Fixture cashier',
                    'role': 'cashier',
                  },
                }
              : status,
        ),
        200,
        headers: {'content-type': 'application/json'},
      );
    }),
  );

  test(
    'command lookup returns accepted metadata through authenticated GET',
    () async {
      final requests = <http.Request>[];
      final expected = {
        'commandId': command,
        'status': 'accepted',
        'action': 'order.payment',
        'acceptedAt': 1000,
      };
      final client = fixture(expected, requests);
      addTearDown(client.close);
      await login(client);
      expect(await client.commandStatus(command), expected);
      expect(requests.last.method, 'GET');
      expect(requests.last.url.path, '/api/v1/commands/$command');
      expect(requests.last.headers['authorization'], startsWith('Bearer '));
    },
  );

  test(
    'command lookup treats unrecorded as a status without sending another command',
    () async {
      final requests = <http.Request>[];
      final expected = {'commandId': command, 'status': 'unrecorded'};
      final client = fixture(expected, requests);
      addTearDown(client.close);
      await login(client);
      expect(await client.commandStatus(command), expected);
      expect(requests.length, 2);
    },
  );

  for (final action in ['order.payment', 'shift.submit-count']) {
    test('command lookup accepts a terminal rejection for $action', () async {
      final expected = {
        'commandId': command,
        'status': 'rejected',
        'action': action,
        'rejectedAt': 1000,
        'error': {
          'code': 'conflict',
          'message': 'The command conflicts with the accepted state.',
        },
      };
      final requests = <http.Request>[];
      final client = fixture(expected, requests);
      addTearDown(client.close);
      await login(client);
      expect(await client.commandStatus(command), expected);
      expect(requests.last.method, 'GET');
      expect(requests.length, 2);
    });
  }

  test('command lookup accepts the existing hyphenated shift action', () async {
    final expected = {
      'commandId': command,
      'status': 'accepted',
      'action': 'shift.submit-count',
      'acceptedAt': 1000,
    };
    final client = fixture(expected, []);
    addTearDown(client.close);
    await login(client);
    expect(await client.commandStatus(command), expected);
  });

  test(
    'terminal rejection metadata rejects malformed or unrelated outcomes',
    () async {
      final valid = <String, dynamic>{
        'commandId': command,
        'status': 'rejected',
        'action': 'order.payment',
        'rejectedAt': 1000,
        'error': {
          'code': 'conflict',
          'message': 'The command conflicts with the accepted state.',
        },
      };
      for (final value in [
        {...valid, 'commandId': 'another-command'},
        {...valid, 'rejectedAt': -1},
        {...valid, 'rejectedAt': 9007199254740992},
        {...valid, 'action': 'order/payment'},
        {
          ...valid,
          'error': {'code': 'unauthorized', 'message': 'Sign in again.'},
        },
        {
          ...valid,
          'error': {'code': 'request_failed', 'message': 'Internal failure.'},
        },
        {
          ...valid,
          'error': {'code': 'conflict', 'message': ''},
        },
        {
          ...valid,
          'error': {
            'code': 'conflict',
            'message': 'Conflict',
            'payload': {'private': true},
          },
        },
        {...valid, 'acceptedAt': 1000},
      ]) {
        final client = fixture(value, []);
        addTearDown(client.close);
        await login(client);
        await expectLater(
          client.commandStatus(command),
          throwsA(
            isA<HubException>().having(
              (error) => error.code,
              'code',
              'invalid_response',
            ),
          ),
        );
      }
    },
  );

  test(
    'malformed or mismatched accepted lookup cannot acknowledge a command',
    () async {
      for (final value in <Object>[
        {'commandId': command, 'status': 'accepted'},
        {'commandId': 'another-command', 'status': 'unrecorded'},
        {'commandId': command, 'status': 'rejected'},
        {
          'commandId': command,
          'status': 'accepted',
          'action': 'order.payment',
          'acceptedAt': -1,
        },
        {
          'commandId': command,
          'status': 'unrecorded',
          'payload': {'secret': 'unexpected'},
        },
      ]) {
        final client = fixture(value, []);
        addTearDown(client.close);
        await login(client);
        await expectLater(
          client.commandStatus(command),
          throwsA(
            isA<HubException>().having(
              (e) => e.code,
              'code',
              'invalid_response',
            ),
          ),
        );
      }
    },
  );

  test('invalid command ID is rejected before a lookup request', () async {
    final requests = <http.Request>[];
    final client = fixture({}, requests);
    addTearDown(client.close);
    await login(client);
    await expectLater(client.commandStatus('../another'), throwsArgumentError);
    expect(requests.length, 1);
  });
}
