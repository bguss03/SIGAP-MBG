# Spesifikasi Teknis Smart Contract (`sigap_mbg`)

Dokumen ini merinci arsitektur on-chain program Anchor `sigap_mbg` yang diimplementasikan pada [`programs/sigap_mbg/src/lib.rs`](../programs/sigap_mbg/src/lib.rs).

- **Program ID (Devnet)**: `HvxaHurWiwNmwkrBwDWE5CMCX1JH4VCNeFkAapmqFPfX`
- **Framework**: Anchor `1.2.2` (Rust `1.89.0`)

---

## 1. Derivasi PDA (Program Derived Address)

| Akun | Seeds | Keterangan |
| --- | --- | --- |
| `Config` | `["config"]` | Konfigurasi global SOP, zona bahaya suhu, admin, dan counter global |
| `Member` | `["member", wallet_pubkey]` | Data keanggotaan instansi & bitmask peran |
| `Batch` | `["batch", batch_id_bytes]` | Data inti satu batch produksi SPPG beserta ringkasan rantai dingin & lab |
| `TempLog` | `["templog", batch_pubkey]` | *Ring buffer* 48 pembacaan suhu terakhir (`48 × 5 menit = 4 jam`) |
| `Delivery` | `["delivery", batch_pubkey, school_pubkey]` | Catatan pengiriman, penerimaan, dan konsumsi untuk satu sekolah |
| `Incident` | `["incident", batch_pubkey, index_u32_le]` | Laporan insiden ke-`index` pada sebuah batch |
| `Recall` | `["recall", batch_pubkey]` | Status pembekuan/recall lintas sekolah dan hasil uji lab BPOM |

---

## 2. Daftar Instruksi

### Tata Kelola Permissioned

| Instruksi | Penandatangan | Parameter | Deskripsi |
| --- | --- | --- | --- |
| `initialize` | `admin` (pertama kali) | `params: ConfigParams` | Menginisialisasi akun `Config` dan menetapkan penandatangan sebagai admin (BGN) |
| `update_config` | `admin` | `params: ConfigParams` | Memperbarui parameter batas SOP dan zona bahaya suhu |
| `set_member` | `admin` | `wallet: Pubkey`, `name: String`, `roles: u8` | Mendaftarkan atau mengubah peran wallet instansi (`roles == 0` menonaktifkan anggota) |

### BatchContract

| Instruksi | Peran Wajib | Parameter | Deskripsi |
| --- | --- | --- | --- |
| `create_batch` | `ROLE_SPPG` | `batch_id`, `menu`, `supplier`, `ingredients_expiry`, `cooked_at`, `retain_sample_id`, `portions` | Membuat akun `Batch` & `TempLog` baru; memvalidasi bahan tidak kedaluwarsa saat dimasak |
| `dispatch_batch` | `ROLE_SPPG` (pemilik batch) | `school: Pubkey`, `portions: u32` | Membuat akun `Delivery` untuk satu sekolah; mengubah status `Diproduksi` → `Dikirim` |
| `confirm_receipt` | `ROLE_SEKOLAH` (tujuan) | — | Mencatat timestamp `received_at` saat makanan tiba di sekolah |
| `record_consumption` | `ROLE_SEKOLAH` (tujuan) | `consumed_at: i64` | Mencatat jam konsumsi; otomatis menaikkan `FLAG_TIME_EXCEEDED` & status `Peringatan` bila melewati `sop_max_minutes` |

### ColdChainContract

| Instruksi | Peran Wajib | Parameter | Deskripsi |
| --- | --- | --- | --- |
| `record_temperatures` | `ROLE_SPPG` (pemilik batch) atau `ROLE_SENSOR` | `readings: Vec<TempReading>` (1–24 data) | Menyimpan suhu (`temp_x10`, satuan `0,1°C`), menghitung akumulasi `danger_seconds`, memperbarui *ring buffer* `TempLog`, memperbarui `temp_log_hash`, dan menaikkan `FLAG_TEMP_DANGER` bila melebihi `danger_max_minutes` |

### IncidentContract & RecallContract

| Instruksi | Peran Wajib | Parameter | Deskripsi |
| --- | --- | --- | --- |
| `report_incident` | `ROLE_SEKOLAH` atau `ROLE_DINKES` | `description: String`, `affected_count: u32`, `evidence_hash: [u8; 32]` | Mencatat laporan gejala satu kali untuk semua instansi dan menaikkan `FLAG_INCIDENT` |
| `verify_incident` | `ROLE_DINKES` | `confirmed: bool`, `note: String` | Memverifikasi atau menolak insiden; jika `confirmed == true`, otomatis membuat/mengaktifkan akun `Recall` dan mengubah status batch menjadi `Dibekukan` |
| `submit_lab_result` | `ROLE_BPOM` | `result_hash: [u8; 32]`, `contaminated: bool` | Mengunggah hash SHA-256 hasil uji lab sampel retain; menetapkan status batch menjadi `Ditarik` (jika terkontaminasi) atau `Dibebaskan` (jika aman) |

---

## 3. Batasan & Konstanta Program

| Konstanta | Nilai | Keterangan |
| --- | --- | --- |
| `MAX_ID` | `32` | Panjang maksimum `batch_id` dan `retain_sample_id` (byte) |
| `MAX_NAME` | `64` | Panjang maksimum nama instansi, menu, dan pemasok |
| `MAX_TEXT` | `200` | Panjang maksimum deskripsi insiden dan catatan verifikasi |
| `TEMP_LOG_CAP` | `48` | Kapasitas *ring buffer* pembacaan suhu pada `TempLog` |
| `MAX_READINGS_PER_TX` | `24` | Maksimum pembacaan suhu dalam satu transaksi |

### Flag Peringatan (`Batch.flags`)

| Konstanta | Nilai | Makna |
| --- | :---: | --- |
| `FLAG_TIME_EXCEEDED` | `1 << 0` (`1`) | Jeda masak ke konsumsi melebihi `sop_max_minutes` |
| `FLAG_TEMP_DANGER` | `1 << 1` (`2`) | Durasi kumulatif di zona bahaya melebihi `danger_max_minutes` |
| `FLAG_INCIDENT` | `1 << 2` (`4`) | Terdapat laporan insiden pada batch |

---

## 4. Algoritma Rantai Hash Suhu

Untuk mencegah manipulasi data suhu setelah kejadian, setiap pembacaan suhu `(ts: i64, temp_x10: i16)` dirantai secara kriptografis menggunakan SHA-256:

```text
H_0 = [0u8; 32]
H_i = SHA256( H_{i-1} || to_le_bytes(ts_i) || to_le_bytes(temp_x10_i) )
```

- Di smart contract (`programs/sigap_mbg/src/lib.rs`), fungsi `solana_sha256_hasher::hashv` memperbarui `batch.temp_log_hash` pada setiap pembacaan.
- Di frontend (`app/src/lib/sigap.ts` — `computeTempChain`), browser menghitung ulang rantai hash dari `TempLog` (selama seluruh pembacaan masih berada dalam *ring buffer* `<= 48`) dan membandingkannya dengan `batch.temp_log_hash` on-chain.

---

## 5. Event On-Chain

| Event | Field | Dipancarkan Saat |
| --- | --- | --- |
| `MemberUpdated` | `wallet`, `roles` | Admin mengubah/mendaftarkan anggota |
| `BatchCreated` | `batch_id`, `sppg`, `cooked_at` | Batch baru dicatat |
| `BatchDispatched` | `batch_id`, `school`, `portions` | Batch dikirim ke sekolah |
| `TimeLimitExceeded` | `batch_id`, `school`, `elapsed_minutes`, `limit_minutes` | Jam konsumsi melewati batas SOP |
| `TemperatureAlert` | `batch_id`, `sppg`, `danger_minutes`, `limit_minutes` | Durasi suhu zona bahaya melewati ambang |
| `IncidentReported` | `batch_id`, `index`, `affected_count` | Insiden baru dilaporkan |
| `RecallTriggered` | `batch_id`, `incident`, `affected_deliveries` | Dinkes memverifikasi insiden & membekukan batch |
| `LabResultSubmitted` | `batch_id`, `contaminated` | BPOM mengunggah hasil uji lab |

---

## 6. Kode Error (`SigapError`)

| Error | Pesan |
| --- | --- |
| `Unauthorized` | Wallet tidak memiliki peran yang dibutuhkan |
| `InvalidId` | ID tidak valid (1–32 karakter) |
| `TextTooLong` | Teks terlalu panjang |
| `InvalidConfig` | Konfigurasi tidak valid |
| `FutureTimestamp` | Waktu berada di masa depan |
| `TimestampTooOld` | Waktu terlalu lampau |
| `InvalidTimestamp` | Waktu tidak valid / tidak berurutan |
| `IngredientExpired` | Bahan baku sudah kedaluwarsa saat dimasak |
| `NotBatchOwner` | Hanya SPPG pemilik batch yang boleh melakukan ini |
| `BatchFrozen` | Batch DIBEKUKAN (recall) — jangan dikonsumsi |
| `AlreadyRecorded` | Data sudah tercatat sebelumnya |
| `TooManyReadings` | Jumlah pembacaan suhu per transaksi 1–24 |
