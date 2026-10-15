// Touch ID : compilé uniquement sur macOS (voir build.rs).
// Les deux fonctions sont appelées depuis Rust (src/security/biometry.rs).
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

// 1 si un capteur Touch ID est présent et qu'au moins une empreinte est enregistrée.
int tracink_biometry_available(void) {
    @autoreleasepool {
        LAContext *context = [[LAContext alloc] init];
        NSError *error = nil;
        BOOL ok = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                                       error:&error];
        return ok ? 1 : 0;
    }
}

// Affiche la demande Touch ID et attend la réponse.
// 0 = reconnu, 1 = annulé par l'utilisateur, 2 = échec ou indisponible.
// Bloquant : à appeler hors du fil principal.
int tracink_biometry_authenticate(const char *reason) {
    @autoreleasepool {
        LAContext *context = [[LAContext alloc] init];
        context.localizedFallbackTitle = @"";
        NSString *text = [NSString stringWithUTF8String:reason];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block int result = 2;

        [context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                localizedReason:text
                          reply:^(BOOL success, NSError *error) {
                            if (success) {
                                result = 0;
                            } else if (error.code == LAErrorUserCancel ||
                                       error.code == LAErrorAppCancel ||
                                       error.code == LAErrorSystemCancel ||
                                       error.code == LAErrorUserFallback) {
                                result = 1;
                            } else {
                                result = 2;
                            }
                            dispatch_semaphore_signal(done);
                          }];

        dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
        return result;
    }
}
