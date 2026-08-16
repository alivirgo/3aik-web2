plugins {
    id("com.android.application")
}

val uploadKeystorePath = providers.environmentVariable("THREEAIK_UPLOAD_KEYSTORE").orNull
val uploadKeyAlias = providers.environmentVariable("THREEAIK_UPLOAD_KEY_ALIAS").orNull
val uploadStorePassword = providers.environmentVariable("THREEAIK_UPLOAD_STORE_PASSWORD").orNull
val uploadKeyPassword = providers.environmentVariable("THREEAIK_UPLOAD_KEY_PASSWORD").orNull
val hasUploadSigning = listOf(
    uploadKeystorePath,
    uploadKeyAlias,
    uploadStorePassword,
    uploadKeyPassword,
).all { !it.isNullOrBlank() }

android {
    namespace = "com.nuc7.threeaikgpt"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.nuc7.threeaikgpt"
        minSdk = 26
        targetSdk = 36
        versionCode = 30000
        versionName = "3.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    signingConfigs {
        if (hasUploadSigning) {
            create("upload") {
                storeFile = file(checkNotNull(uploadKeystorePath))
                storePassword = checkNotNull(uploadStorePassword)
                keyAlias = checkNotNull(uploadKeyAlias)
                keyPassword = checkNotNull(uploadKeyPassword)
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("upload")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE*",
            "META-INF/NOTICE*",
        )
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    // 1.19.0 requires compileSdk 37; 1.18.0 is the newest stable line for API 36.
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.webkit:webkit:1.17.0")
    implementation("com.google.android.material:material:1.14.0")

    testImplementation("junit:junit:4.13.2")
}
