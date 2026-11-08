part of 'staff_app.dart';

const _amendmentOperations = {
  'note': 'Change preparation note',
  'add': 'Add item',
  'quantity': 'Change quantity',
  'remove': 'Remove item',
  'replace': 'Replace item',
};

bool _stationReviewPending(Map<String, dynamic> order) =>
    (order['amendment'] as Map?)?['status'] == 'awaiting_station';

bool _stagedPriceChange(Map<String, dynamic> order) {
  final amendment = order['amendment'] as Map?;
  final before = amendment?['totalBeforeCentavos'];
  final after = amendment?['totalAfterCentavos'];
  return amendment?['status'] == 'awaiting_station' &&
      amendment?['appliedAt'] == null &&
      (before is int && after is int
          ? before != after
          : amendment?['operation'] != 'note');
}

String _lineDescription(Map line) {
  final note = line['note'] as String? ?? '';
  return '${line['quantity']} × ${line['name']}${note.isEmpty ? '' : '\n$note'}';
}

class _AmendmentSummary extends StatelessWidget {
  final Map amendment;
  const _AmendmentSummary(this.amendment);

  @override
  Widget build(BuildContext context) {
    final status = switch (amendment['status']) {
      'awaiting_approval' => 'Change awaiting manager approval',
      'denied' => 'Manager declined the change',
      'stale' => 'Order change was superseded. Review the current order.',
      'awaiting_station' when amendment['appliedAt'] == null =>
        'Change awaiting station review',
      'awaiting_station' => 'Change sent to bar. Awaiting acknowledgment.',
      'resolved' => 'Station acknowledged the change',
      _ => null,
    };
    if (status == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Semantics(
        liveRegion: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(status, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (amendment['decisionReason'] case final String reason)
              if (reason.isNotEmpty) Text(reason),
          ],
        ),
      ),
    );
  }
}

extension _StaffAmendments on _StaffHomeState {
  Future<void> _changeSentOrder(Map<String, dynamic> order) async {
    final lines = (order['lines'] as List)
        .whereType<Map>()
        .where((line) => line['lineNo'] is int)
        .toList();
    if (lines.isEmpty || _locked) return;
    final paid = order['paymentState'] == 'paid';
    final canChangePrice = orderCanChangePrice(order);
    final products = _products
        .where((product) => product['id'] is String)
        .toList();
    var operation = 'note';
    var line = lines.first;
    var productId = products.isEmpty ? null : products.first['id'] as String;
    final quantity = TextEditingController(text: '${line['quantity']}');
    final note = TextEditingController(text: line['note'] as String? ?? '');
    final reason = TextEditingController();
    var saving = false;
    String? error;

    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) {
          final usesProduct = operation == 'add' || operation == 'replace';
          final usesQuantity = usesProduct || operation == 'quantity';
          final usesNote = usesProduct || operation == 'note';
          final managerReview = amendmentNeedsManagerReview(
            operation,
            line['quantity'] as int?,
            int.tryParse(quantity.text.trim()) ?? 99,
          );
          return AlertDialog(
            title: Text('Change sent order · Order #${order['orderNo']}'),
            scrollable: true,
            content: SizedBox(
              width: 440,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (canChangePrice)
                    DropdownButtonFormField<String>(
                      value: operation,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Change type',
                      ),
                      items: [
                        for (final option in _amendmentOperations.entries)
                          if ((option.key != 'remove' || lines.length > 1) &&
                              (!{'add', 'replace'}.contains(option.key) ||
                                  products.isNotEmpty))
                            DropdownMenuItem(
                              value: option.key,
                              child: Text(option.value),
                            ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) {
                              if (value == null) return;
                              update(() {
                                operation = value;
                                quantity.text = value == 'add'
                                    ? '1'
                                    : '${line['quantity']}';
                                note.text = value == 'note'
                                    ? line['note'] as String? ?? ''
                                    : '';
                                error = null;
                              });
                            },
                    )
                  else
                    Text(
                      paid
                          ? 'You can update preparation instructions. For a price change, use a manager-approved cancellation or refund, then enter a new order.'
                          : 'You can update preparation instructions. Review the existing payment or discount before making a price change.',
                    ),
                  if (operation != 'add') ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<int>(
                      value: line['lineNo'] as int,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Order item',
                      ),
                      items: [
                        for (final item in lines)
                          DropdownMenuItem(
                            value: item['lineNo'] as int,
                            child: Text(
                              '${item['quantity']} × ${item['name']}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) {
                              if (value == null) return;
                              update(() {
                                line = lines.firstWhere(
                                  (item) => item['lineNo'] == value,
                                );
                                quantity.text = '${line['quantity']}';
                                if (operation == 'note') {
                                  note.text = line['note'] as String? ?? '';
                                }
                                error = null;
                              });
                            },
                    ),
                  ],
                  if (usesProduct) ...[
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      value: productId,
                      isExpanded: true,
                      decoration: const InputDecoration(labelText: 'Menu item'),
                      items: [
                        for (final product in products)
                          DropdownMenuItem(
                            value: product['id'] as String,
                            child: Text(
                              '${product['name']} · ${_money(product['priceCentavos'])}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) => update(() => productId = value),
                    ),
                  ],
                  if (usesQuantity) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: quantity,
                      enabled: !saving,
                      maxLength: 2,
                      keyboardType: TextInputType.number,
                      onChanged: (_) => update(() => error = null),
                      decoration: const InputDecoration(labelText: 'Quantity'),
                    ),
                  ],
                  if (usesNote) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: note,
                      enabled: !saving,
                      maxLength: 300,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: 'Preparation note',
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextField(
                    controller: reason,
                    enabled: !saving,
                    maxLength: 300,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Reason for change',
                    ),
                  ),
                  Text(
                    managerReview
                        ? 'A manager must approve this change before the station receives it.'
                        : 'The barista will review the change before marking the order ready.',
                  ),
                  if (canChangePrice &&
                      lines.length == 1 &&
                      operation == 'quantity')
                    const Text(
                      'To remove the only item, request cancellation from the order.',
                    ),
                  if (error != null)
                    Semantics(liveRegion: true, child: Text(error!)),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(dialogContext),
                child: const Text('Back'),
              ),
              FilledButton(
                onPressed: saving || _locked
                    ? null
                    : () async {
                        final count = int.tryParse(quantity.text.trim());
                        final instructions = note.text.trim();
                        final explanation = reason.text.trim();
                        String? validation;
                        if (explanation.isEmpty) {
                          validation = 'Enter a reason for the change.';
                        } else if (usesQuantity &&
                            (count == null || count < 1 || count > 99)) {
                          validation = 'Enter a quantity from 1 to 99.';
                        } else if (operation == 'quantity' &&
                            count == line['quantity']) {
                          validation = 'Enter a different quantity.';
                        } else if (operation == 'note' &&
                            instructions == (line['note'] ?? '')) {
                          validation = 'Enter a different preparation note.';
                        } else if (usesProduct && productId == null) {
                          validation = 'Select a menu item.';
                        }
                        if (validation != null) {
                          update(() => error = validation);
                          return;
                        }
                        update(() {
                          saving = true;
                          error = null;
                        });
                        final result = await _mutate(
                          'Order change',
                          '/api/v1/orders/${order['id']}/amendments',
                          expectedVersion: order['version'] as int,
                          payload: {
                            'operation': operation,
                            'reason': explanation,
                            if (operation != 'add') 'lineNo': line['lineNo'],
                            if (usesProduct) 'productId': productId,
                            if (usesQuantity) 'quantity': count,
                            if (usesNote) 'note': instructions,
                          },
                        );
                        if (!dialogContext.mounted) return;
                        if (result != null || _pending != null) {
                          Navigator.pop(dialogContext);
                        } else {
                          update(() {
                            saving = false;
                            error = _error;
                          });
                        }
                      },
                child: Text(
                  saving
                      ? 'Sending…'
                      : managerReview
                      ? 'Send for approval'
                      : 'Send change to bar',
                ),
              ),
            ],
          );
        },
      ),
    );
    for (final controller in [quantity, note, reason]) {
      controller.dispose();
    }
  }

  Future<void> _reviewOrderChange(Map<String, dynamic> order) async {
    final amendment = order['amendment'] as Map;
    final needsDisposition = amendment['needsDisposition'] == true;
    final disposition = _RecipeDispositionFields(
      amendment['recipe'] as List,
      verb: 'discarded',
    );
    final note = TextEditingController();
    bool? discarded = needsDisposition && disposition.isNotEmpty ? null : false;
    var saving = false;
    String? error;
    await _showOwnedDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text('Review order change · Order #${order['orderNo']}'),
          scrollable: true,
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (needsDisposition)
                  const Text(
                    'Pause the affected item. Record any ingredients discarded because of the change.',
                  ),
                Text('${amendment['reason']}'),
                const Divider(),
                if (amendment['before'] case final Map before) ...[
                  const Text(
                    'Before',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  Text(_lineDescription(before)),
                  const SizedBox(height: 8),
                ],
                const Text(
                  'After',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                Text(
                  amendment['after'] is Map
                      ? _lineDescription(amendment['after'] as Map)
                      : 'Item removed',
                ),
                if (needsDisposition && disposition.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<bool>(
                    value: discarded,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Preparation disposition',
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: false,
                        child: Text('No ingredients discarded'),
                      ),
                      DropdownMenuItem(
                        value: true,
                        child: Text('Ingredients discarded'),
                      ),
                    ],
                    onChanged: saving
                        ? null
                        : (value) => update(() {
                            discarded = value;
                            error = null;
                          }),
                  ),
                  if (discarded == true) ...[
                    const SizedBox(height: 12),
                    const Text(
                      'Enter the amounts actually discarded. Leave the rest blank.',
                    ),
                    ...disposition.buildInputs(enabled: !saving, topPadding: 8),
                  ],
                ],
                if (needsDisposition) ...[
                  const SizedBox(height: 12),
                  TextField(
                    controller: note,
                    enabled: !saving,
                    maxLength: 300,
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: discarded == true
                          ? 'Disposition note'
                          : 'Disposition note (optional)',
                    ),
                  ),
                ],
                if (error != null)
                  Semantics(liveRegion: true, child: Text(error!)),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: const Text('Back'),
            ),
            FilledButton(
              onPressed: saving || _locked
                  ? null
                  : () async {
                      if (discarded == null) {
                        update(
                          () => error =
                              'Select what happened to the affected ingredients.',
                        );
                        return;
                      }
                      var used = const <Map<String, dynamic>>[];
                      if (discarded == true) {
                        final parsed = disposition.parse();
                        if (parsed.error != null) {
                          update(() => error = parsed.error);
                          return;
                        }
                        used = parsed.used!;
                        if (used.isEmpty || note.text.trim().isEmpty) {
                          update(
                            () => error =
                                'Enter the amount discarded and a disposition note.',
                          );
                          return;
                        }
                      }
                      update(() {
                        saving = true;
                        error = null;
                      });
                      final result = await _mutate(
                        'Station acknowledgment',
                        '/api/v1/orders/${order['id']}/amendments/${amendment['id']}/acknowledge',
                        expectedVersion: order['version'] as int,
                        payload: {'note': note.text.trim(), 'used': used},
                      );
                      if (!dialogContext.mounted) return;
                      if (result != null || _pending != null) {
                        Navigator.pop(dialogContext);
                      } else {
                        update(() {
                          saving = false;
                          error = _error;
                        });
                      }
                    },
              child: Text(saving ? 'Recording…' : 'Acknowledge change'),
            ),
          ],
        ),
      ),
    );
    disposition.dispose();
    note.dispose();
  }
}
