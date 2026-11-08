package com.cafedos.cafe_dos

import android.content.Context
import android.os.Build
import android.security.KeyPairGeneratorSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import android.util.AtomicFile
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.util.Calendar
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.security.auth.x500.X500Principal

/** One private encrypted state file, committed synchronously before a POST. */
internal class RecoveryStorage(private val context: Context) {
    companion object {
        private val processLock = Any()
    }
    private val path = File(context.noBackupFilesDir, "staff-recovery-v1.bin")
    private val atomic = AtomicFile(path)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val maxStateBytes = 2 * 1024 * 1024
    private val magic = 0x4b445a31
    private val aesAlias = "kape_doz_recovery_aes_v1"
    private val rsaAlias = "kape_doz_recovery_rsa_v1"

    private fun readEncoded(): ByteArray = atomic.openRead().use { input ->
        val buffer = ByteArray(8192)
        val output = ByteArrayOutputStream()
        while (true) {
            val size = input.read(buffer)
            if (size < 0) break
            require(output.size() + size <= maxStateBytes + 1024)
            output.write(buffer, 0, size)
        }
        output.toByteArray()
    }

    fun read(): String? = synchronized(processLock) {
        if (!path.exists() && !File(path.path + ".bak").exists() && !File(path.path + ".new").exists()) return@synchronized null
        val encoded = readEncoded()
        val input = DataInputStream(ByteArrayInputStream(encoded))
        require(input.readInt() == magic)
        val kind = input.readUnsignedByte()
        val wrappedSize = input.readUnsignedShort()
        require((kind == 1 && wrappedSize == 0) || (kind == 2 && wrappedSize == 256))
        val wrapped = ByteArray(wrappedSize).also { input.readFully(it) }
        require(input.readUnsignedByte() == 12)
        val iv = ByteArray(12).also { input.readFully(it) }
        val headerSize = encoded.size - input.available()
        val size = input.readInt()
        require(size in 16..(maxStateBytes + 16) && size == input.available())
        val ciphertext = ByteArray(size).also { input.readFully(it) }
        val key = if (kind == 1) existingAesKey() else {
            val unwrap = Cipher.getInstance("RSA/ECB/PKCS1Padding")
            unwrap.init(Cipher.DECRYPT_MODE, keyStore.getKey(rsaAlias, null) as PrivateKey)
            val rawKey = unwrap.doFinal(wrapped)
            require(rawKey.size == 32)
            SecretKeySpec(rawKey, "AES").also { rawKey.fill(0) }
        }
        val decrypt = Cipher.getInstance("AES/GCM/NoPadding")
        decrypt.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        decrypt.updateAAD(encoded.copyOfRange(0, headerSize))
        val plaintext = decrypt.doFinal(ciphertext)
        require(plaintext.size <= maxStateBytes)
        plaintext.toString(Charsets.UTF_8)
    }

    fun write(state: String, expected: String?) = synchronized(processLock) {
        val plaintext = state.toByteArray(Charsets.UTF_8)
        require(plaintext.size in 1..maxStateBytes)
        // A present state must be readable before it can be replaced.
        check(read() == expected) { "Saved state changed." }
        val kind = if (Build.VERSION.SDK_INT >= 23) 1 else 2
        val wrapped: ByteArray
        val key: SecretKey
        if (kind == 1) {
            key = createOrReadAesKey()
            wrapped = ByteArray(0)
        } else {
            ensureLegacyWrappingKey()
            val rawKey = ByteArray(32).also { SecureRandom().nextBytes(it) }
            key = SecretKeySpec(rawKey, "AES")
            val wrap = Cipher.getInstance("RSA/ECB/PKCS1Padding")
            wrap.init(Cipher.ENCRYPT_MODE, keyStore.getCertificate(rsaAlias).publicKey)
            wrapped = wrap.doFinal(rawKey)
            rawKey.fill(0)
        }
        val encrypt = Cipher.getInstance("AES/GCM/NoPadding")
        encrypt.init(Cipher.ENCRYPT_MODE, key)
        val iv = encrypt.iv
        require(iv.size == 12)
        val header = ByteArrayOutputStream().also { buffer ->
            DataOutputStream(buffer).use {
                it.writeInt(magic)
                it.writeByte(kind)
                it.writeShort(wrapped.size)
                it.write(wrapped)
                it.writeByte(iv.size)
                it.write(iv)
            }
        }.toByteArray()
        encrypt.updateAAD(header)
        val ciphertext = encrypt.doFinal(plaintext)
        plaintext.fill(0)
        val encoded = ByteArrayOutputStream().also { buffer ->
            DataOutputStream(buffer).use {
                it.write(header)
                it.writeInt(ciphertext.size)
                it.write(ciphertext)
            }
        }.toByteArray()
        val output = atomic.startWrite()
        try {
            output.write(encoded)
            output.flush()
            output.fd.sync()
        } catch (error: Exception) {
            atomic.failWrite(output)
            throw error
        }
        atomic.finishWrite(output)
        val actual = readEncoded()
        check(MessageDigest.isEqual(encoded, actual))
        val directory = Os.open(path.parentFile!!.absolutePath, OsConstants.O_RDONLY, 0)
        try { Os.fsync(directory) } finally { Os.close(directory) }
    }

    private fun existingAesKey(): SecretKey = keyStore.getKey(aesAlias, null) as SecretKey

    private fun createOrReadAesKey(): SecretKey {
        if (keyStore.containsAlias(aesAlias)) return existingAesKey()
        check(Build.VERSION.SDK_INT >= 23)
        val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(aesAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return generator.generateKey()
    }

    @Suppress("DEPRECATION")
    private fun ensureLegacyWrappingKey() {
        if (keyStore.containsAlias(rsaAlias)) return
        val start = Calendar.getInstance()
        val end = Calendar.getInstance().apply { add(Calendar.YEAR, 50) }
        val generator = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore")
        generator.initialize(KeyPairGeneratorSpec.Builder(context)
            .setAlias(rsaAlias)
            .setKeySize(2048)
            .setSubject(X500Principal("CN=KAPE DOZ recovery"))
            .setSerialNumber(BigInteger.ONE)
            .setStartDate(start.time)
            .setEndDate(end.time)
            .build())
        generator.generateKeyPair()
    }
}
