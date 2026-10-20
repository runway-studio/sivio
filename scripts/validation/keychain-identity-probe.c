// Isolated test only: callers supply a temporary keychain; no default/login access.
#include <Security/Security.h>
#include <stdio.h>
#include <string.h>
#ifndef VERSION
#define VERSION 1
#endif
int main(int argc, char **argv) {
    if (argc != 3) return 2;
    SecKeychainRef keychain = NULL;
    OSStatus status = SecKeychainOpen(argv[2], &keychain);
    if (status != errSecSuccess) return 3;
    SecKeychainSetUserInteractionAllowed(false);
    const char *service = "local.sivio.isolated-signing-fixture";
    const char *account = "immutable-reference";
    const char *fixture = "isolated-fixture-only";
    if (strcmp(argv[1], "create") == 0) {
        status = SecKeychainAddGenericPassword(keychain, (UInt32)strlen(service), service,
           (UInt32)strlen(account), account, (UInt32)strlen(fixture), fixture, NULL);
    } else if (strcmp(argv[1], "lock") == 0) {
        status = SecKeychainLock(keychain);
    } else {
        UInt32 length = 0; void *data = NULL;
        status = SecKeychainFindGenericPassword(keychain, (UInt32)strlen(service), service,
           (UInt32)strlen(account), account, &length, &data, NULL);
        if (status == errSecSuccess) {
            if (length != strlen(fixture) || memcmp(data, fixture, length) != 0) status = -1;
            SecKeychainItemFreeContent(NULL, data);
        }
    }
    SecKeychainStatus flags = 0;
    SecKeychainGetStatus(keychain, &flags);
    printf("{\"version\":%d,\"status\":%d,\"unlocked\":%s}\n", VERSION, (int)status, (flags & kSecUnlockStateStatus) ? "true" : "false");
    CFRelease(keychain);
    return 0;
}
