import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Returns 1 when Apple on-device Foundation Models are ready to use.
@_cdecl("uebrig_apple_fm_available")
public func uebrig_apple_fm_available() -> Int32 {
  #if canImport(FoundationModels)
  if #available(macOS 26.0, *) {
    return AppleFMBridge.isAvailable() ? 1 : 0
  }
  #endif
  return 0
}

/// Provider label for UI ("apple" or empty). Caller must free with uebrig_apple_fm_free.
@_cdecl("uebrig_apple_fm_provider")
public func uebrig_apple_fm_provider() -> UnsafeMutablePointer<CChar>? {
  #if canImport(FoundationModels)
  if #available(macOS 26.0, *) {
    if AppleFMBridge.isAvailable() {
      return strdup("apple")
    }
  }
  #endif
  return strdup("")
}

/**
 Categorize transactions with Apple on-device Foundation Models.

 - Parameters:
   - transactions_json: JSON array of
     `{ "id", "counterparty", "purpose", "amount", "bookingType" }`
   - category_ids_json: JSON array of allowed category id strings
 - Returns: JSON array of `{ "id", "categoryId" }`, or NULL on failure.
   Caller must free with `uebrig_apple_fm_free`.
 */
@_cdecl("uebrig_apple_fm_categorize")
public func uebrig_apple_fm_categorize(
  _ transactions_json: UnsafePointer<CChar>?,
  _ category_ids_json: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
  #if canImport(FoundationModels)
  if #available(macOS 26.0, *) {
    guard let transactions_json, let category_ids_json else {
      return nil
    }
    let txJson = String(cString: transactions_json)
    let catJson = String(cString: category_ids_json)
    do {
      let out = try AppleFMBridge.categorize(transactionsJson: txJson, categoryIdsJson: catJson)
      return strdup(out)
    } catch {
      fputs("uebrig Apple FM: \(error.localizedDescription)\n", stderr)
      return nil
    }
  }
  #endif
  return nil
}

/// Free-form completion for a single prompt. Caller must free the result.
@_cdecl("uebrig_apple_fm_complete")
public func uebrig_apple_fm_complete(
  _ prompt: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
  #if canImport(FoundationModels)
  if #available(macOS 26.0, *) {
    guard let prompt else { return nil }
    let text = String(cString: prompt)
    do {
      let out = try AppleFMBridge.complete(prompt: text)
      return strdup(out)
    } catch {
      fputs("uebrig Apple FM complete: \(error.localizedDescription)\n", stderr)
      return nil
    }
  }
  #endif
  return nil
}

@_cdecl("uebrig_apple_fm_free")
public func uebrig_apple_fm_free(_ ptr: UnsafeMutablePointer<CChar>?) {
  if let ptr {
    free(ptr)
  }
}

#if canImport(FoundationModels)
@available(macOS 26.0, *)
enum AppleFMBridge {
  static func isAvailable() -> Bool {
    SystemLanguageModel.default.isAvailable
  }

  static func complete(prompt: String) throws -> String {
    guard isAvailable() else {
      throw NSError(
        domain: "uebrig.apple_fm",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Apple Foundation Models unavailable"]
      )
    }
    let session = LanguageModelSession()
    return try runBlocking {
      let response = try await session.respond(to: prompt)
      return response.content
    }
  }

  struct TxIn: Decodable {
    let id: String
    let counterparty: String
    let purpose: String
    let amount: Double
    let bookingType: String
  }

  struct Assignment: Codable {
    let id: String
    let categoryId: String
  }

  static func categorize(transactionsJson: String, categoryIdsJson: String) throws -> String {
    guard isAvailable() else {
      throw NSError(
        domain: "uebrig.apple_fm",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Apple Foundation Models unavailable"]
      )
    }

    let txData = Data(transactionsJson.utf8)
    let catData = Data(categoryIdsJson.utf8)
    let transactions = try JSONDecoder().decode([TxIn].self, from: txData)
    var categoryIds = try JSONDecoder().decode([String].self, from: catData)
    categoryIds = categoryIds.filter { $0 != "uncategorized" }

    guard !categoryIds.isEmpty else {
      return "[]"
    }
    if transactions.isEmpty {
      return "[]"
    }

    let allowed = Set(categoryIds)
    let allowedList = categoryIds.joined(separator: ", ")

    // Process in small batches to keep prompts short and reliable.
    let batchSize = 8
    var results: [Assignment] = []
    results.reserveCapacity(transactions.count)

    var start = 0
    while start < transactions.count {
      let end = min(start + batchSize, transactions.count)
      let batch = Array(transactions[start..<end])
      let assigned = try categorizeBatch(batch, allowedList: allowedList, allowed: allowed)
      results.append(contentsOf: assigned)
      start = end
    }

    let data = try JSONEncoder().encode(results)
    return String(data: data, encoding: .utf8) ?? "[]"
  }

  private static func categorizeBatch(
    _ batch: [TxIn],
    allowedList: String,
    allowed: Set<String>
  ) throws -> [Assignment] {
    let lines = batch.enumerated().map { idx, tx in
      let cp = String(tx.counterparty.prefix(120))
      let purpose = String(tx.purpose.prefix(200))
      let type = String(tx.bookingType.prefix(40))
      return """
      \(idx + 1). id=\(tx.id)
         counterparty=\(cp)
         purpose=\(purpose)
         type=\(type)
         amount_eur=\(String(format: "%.2f", tx.amount))
      """
    }.joined(separator: "\n")

    let instructions = """
    You categorize German bank / broker transactions for a household budget app.
    Pick exactly one category id per transaction from this list: \(allowedList).
    Reply with ONLY a JSON array of objects: [{"id":"<transaction id>","categoryId":"<id>"}].
    No markdown, no commentary. Every input id must appear exactly once.
    """

    let prompt = """
    \(instructions)

    Transactions:
    \(lines)
    """

    let session = LanguageModelSession()
    let content: String = try runBlocking {
      let response = try await session.respond(to: prompt)
      return response.content
    }

    let raw = content.trimmingCharacters(in: .whitespacesAndNewlines)
    let jsonSlice = extractJsonArray(from: raw) ?? raw
    guard let data = jsonSlice.data(using: .utf8) else { return [] }

    let decoded: [Assignment]
    do {
      decoded = try JSONDecoder().decode([Assignment].self, from: data)
    } catch {
      // Single-object fallback
      if let one = try? JSONDecoder().decode(Assignment.self, from: data) {
        decoded = [one]
      } else {
        fputs("uebrig Apple FM parse error: \(raw.prefix(200))\n", stderr)
        return []
      }
    }

    let byId = Dictionary(uniqueKeysWithValues: batch.map { ($0.id, $0) })
    return decoded.compactMap { a in
      guard byId[a.id] != nil else { return nil }
      let cleaned = normalizeCategory(a.categoryId)
      guard allowed.contains(cleaned) else { return nil }
      return Assignment(id: a.id, categoryId: cleaned)
    }
  }

  private static func normalizeCategory(_ raw: String) -> String {
    let trimmed = raw
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`."))
    let token = trimmed.split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
    return String(token.unicodeScalars.filter { allowed.contains($0) }).lowercased()
  }

  private static func extractJsonArray(from text: String) -> String? {
    guard let start = text.firstIndex(of: "["),
          let end = text.lastIndex(of: "]"),
          start < end
    else { return nil }
    return String(text[start...end])
  }

  private static func runBlocking(
    _ work: @escaping @Sendable () async throws -> String
  ) throws -> String {
    let box = ResultBox()
    let sem = DispatchSemaphore(value: 0)
    Task {
      do {
        box.value = .success(try await work())
      } catch {
        box.value = .failure(error)
      }
      sem.signal()
    }
    sem.wait()
    switch box.value {
    case .success(let v): return v
    case .failure(let e): throw e
    case .none:
      throw NSError(
        domain: "uebrig.apple_fm",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Apple FM task produced no result"]
      )
    }
  }
}

@available(macOS 26.0, *)
private final class ResultBox: @unchecked Sendable {
  var value: Result<String, Error>?
}
#endif
