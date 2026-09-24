# Discord Voice Bot Android App Skeleton

This project is a starter Android app for a Discord-style voice bot controller. It includes a UI for:

- bot token entry
- loading token from a TXT file
- joining all voice channels by ID
- leaving all voice channels
- mute / unmute all
- deafen / undeafen all
- upload sound file
- play sound on all connected channels
- stop sound
- increase volume
- log output

## Requirements

- Android Studio
- JDK 17+
- Android SDK with API 26+ (Android 8 to 16 support target range)

## Notes

This is a UI scaffold and controller layer. To make the app fully functional with Discord voice calls, you still need a real Discord bot backend or a library/service integration in production.

## Build

1. Open the folder in Android Studio.
2. Let Gradle sync.
3. Build > Generate Signed Bundle/APK or Run on device.

If Android Studio is not installed, install Android Studio and then point the SDK path to the Android SDK.
