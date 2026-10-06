import Foundation
import Security

enum SecureStorage {
    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "haus.glashaus.ios",
         kSecAttrAccount as String: key]
    }
    static func read<T: Decodable>(_ key: String, as type: T.Type) throws -> T? {
        var query = query(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        if status == errSecInteractionNotAllowed {
            throw ClientError.message("Unlock your iPhone to read its saved connection.")
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw ClientError.message("The phone’s secure storage is unavailable. Restart the app and try again.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    static func save<T: Encodable>(_ value: T, key: String) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(key)
            item.merge(attributes) { _, new in new }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
                throw ClientError.message("The connection could not be saved securely. Unlock the phone and try again.")
            }
        } else if status != errSecSuccess {
            throw ClientError.message("Your changes could not be saved securely. Unlock the phone and try again.")
        }
    }
    static func delete(_ key: String) throws {
        let status = SecItemDelete(query(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ClientError.message("Unlock your iPhone to remove the saved connection.")
        }
    }
}
