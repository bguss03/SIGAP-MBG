//! SIGAP-MBG — Ketertelusuran keamanan pangan per-batch untuk Program MBG di Solana.
//!
//! Satu program Anchor yang dibagi menjadi empat "kontrak" logis sesuai arsitektur:
//!   * BatchContract     : create_batch, dispatch_batch, confirm_receipt, record_consumption
//!   * ColdChainContract : record_temperatures
//!   * IncidentContract  : report_incident, verify_incident
//!   * RecallContract    : (dipicu otomatis oleh verify_incident), submit_lab_result
//!
//! Model izin (meniru ledger permissioned): admin (BGN) mendaftarkan wallet instansi
//! beserta perannya. Setiap instruksi memeriksa peran penandatangan.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

declare_id!("HvxaHurWiwNmwkrBwDWE5CMCX1JH4VCNeFkAapmqFPfX");

// ---------------------------------------------------------------------------
// Konstanta peran (bitmask — satu wallet boleh punya beberapa peran untuk demo)
// ---------------------------------------------------------------------------
pub const ROLE_SPPG: u8 = 1 << 0; // Dapur SPPG
pub const ROLE_SEKOLAH: u8 = 1 << 1; // Guru / sekolah penerima
pub const ROLE_DINKES: u8 = 1 << 2; // Kemenkes / Dinkes / Puskesmas
pub const ROLE_BPOM: u8 = 1 << 3; // BPOM (uji lab)
pub const ROLE_SENSOR: u8 = 1 << 4; // Perangkat IoT sensor suhu
pub const ROLE_BGN: u8 = 1 << 5; // Badan Gizi Nasional (pengawas)

// Flag peringatan pada batch
pub const FLAG_TIME_EXCEEDED: u8 = 1 << 0;
pub const FLAG_TEMP_DANGER: u8 = 1 << 1;
pub const FLAG_INCIDENT: u8 = 1 << 2;

pub const MAX_ID: usize = 32;
pub const MAX_NAME: usize = 64;
pub const MAX_TEXT: usize = 200;
pub const TEMP_LOG_CAP: usize = 48; // 48 x 5 menit = 4 jam riwayat terakhir
pub const MAX_READINGS_PER_TX: usize = 24;

#[program]
pub mod sigap_mbg {
    use super::*;

    // ======================== ADMIN / KONFIGURASI ========================

    pub fn initialize(ctx: Context<Initialize>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        let cfg = &mut ctx.accounts.config;
        cfg.admin = ctx.accounts.admin.key();
        cfg.apply(&params);
        cfg.batch_count = 0;
        cfg.incident_count = 0;
        cfg.recall_count = 0;
        cfg.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: ConfigParams) -> Result<()> {
        params.validate()?;
        ctx.accounts.config.apply(&params);
        Ok(())
    }

    /// Admin (BGN) mendaftarkan / mengubah peran sebuah wallet instansi.
    pub fn set_member(ctx: Context<SetMember>, wallet: Pubkey, name: String, roles: u8) -> Result<()> {
        require!(name.len() <= MAX_NAME, SigapError::TextTooLong);
        let m = &mut ctx.accounts.member;
        m.wallet = wallet;
        m.name = name;
        m.roles = roles;
        m.active = roles != 0;
        m.bump = ctx.bumps.member;
        emit!(MemberUpdated { wallet, roles });
        Ok(())
    }

    // =========================== BATCH CONTRACT ===========================

    #[allow(clippy::too_many_arguments)]
    pub fn create_batch(
        ctx: Context<CreateBatch>,
        batch_id: String,
        menu: String,
        supplier: String,
        ingredients_expiry: i64,
        cooked_at: i64,
        retain_sample_id: String,
        portions: u32,
    ) -> Result<()> {
        require!(!batch_id.is_empty() && batch_id.len() <= MAX_ID, SigapError::InvalidId);
        require!(retain_sample_id.len() <= MAX_ID, SigapError::InvalidId);
        require!(menu.len() <= MAX_NAME && supplier.len() <= MAX_NAME, SigapError::TextTooLong);
        ctx.accounts.member.require_role(ROLE_SPPG)?;

        let now = Clock::get()?.unix_timestamp;
        require!(cooked_at <= now + 60, SigapError::FutureTimestamp);
        require!(cooked_at >= now - 24 * 3600, SigapError::TimestampTooOld);
        require!(ingredients_expiry >= cooked_at, SigapError::IngredientExpired);

        let b = &mut ctx.accounts.batch;
        b.batch_id = batch_id.clone();
        b.sppg = ctx.accounts.authority.key();
        b.menu = menu;
        b.supplier = supplier;
        b.ingredients_expiry = ingredients_expiry;
        b.cooked_at = cooked_at;
        b.retain_sample_id = retain_sample_id;
        b.portions = portions;
        b.created_at = now;
        b.status = BatchStatus::Diproduksi;
        b.flags = 0;
        b.delivery_count = 0;
        b.incident_count = 0;
        b.temp_count = 0;
        b.last_temp_at = 0;
        b.last_temp_x10 = 0;
        b.min_temp_x10 = i16::MAX;
        b.max_temp_x10 = i16::MIN;
        b.danger_seconds = 0;
        b.temp_log_hash = [0u8; 32];
        b.lab_hash = [0u8; 32];
        b.bump = ctx.bumps.batch;

        let log = &mut ctx.accounts.temp_log;
        log.batch = b.key();
        log.head = 0;
        log.readings = Vec::new();
        log.bump = ctx.bumps.temp_log;

        let cfg = &mut ctx.accounts.config;
        cfg.batch_count = cfg.batch_count.saturating_add(1);

        emit!(BatchCreated { batch_id, sppg: b.sppg, cooked_at });
        Ok(())
    }

    /// Batch dikirim ke satu sekolah (dipanggil sekali per sekolah tujuan).
    pub fn dispatch_batch(ctx: Context<DispatchBatch>, school: Pubkey, portions: u32) -> Result<()> {
        ctx.accounts.member.require_role(ROLE_SPPG)?;
        let b = &mut ctx.accounts.batch;
        require_keys_eq!(b.sppg, ctx.accounts.authority.key(), SigapError::NotBatchOwner);
        require!(!b.is_frozen(), SigapError::BatchFrozen);

        let now = Clock::get()?.unix_timestamp;
        let d = &mut ctx.accounts.delivery;
        d.batch = b.key();
        d.school = school;
        d.portions = portions;
        d.dispatched_at = now;
        d.received_at = 0;
        d.consumed_at = 0;
        d.flags = 0;
        d.bump = ctx.bumps.delivery;

        b.delivery_count = b.delivery_count.saturating_add(1);
        if b.status == BatchStatus::Diproduksi {
            b.status = BatchStatus::Dikirim;
        }
        emit!(BatchDispatched { batch_id: b.batch_id.clone(), school, portions });
        Ok(())
    }

    /// Sekolah scan QR saat boks tiba.
    pub fn confirm_receipt(ctx: Context<SchoolAction>) -> Result<()> {
        ctx.accounts.member.require_role(ROLE_SEKOLAH)?;
        let d = &mut ctx.accounts.delivery;
        require!(d.received_at == 0, SigapError::AlreadyRecorded);
        d.received_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Sekolah mencatat jam konsumsi. Aturan "Batas waktu" dijalankan di sini.
    pub fn record_consumption(ctx: Context<SchoolAction>, consumed_at: i64) -> Result<()> {
        ctx.accounts.member.require_role(ROLE_SEKOLAH)?;
        let cfg = &ctx.accounts.config;
        let b = &mut ctx.accounts.batch;
        let d = &mut ctx.accounts.delivery;
        require!(!b.is_frozen(), SigapError::BatchFrozen);
        require!(d.consumed_at == 0, SigapError::AlreadyRecorded);

        let now = Clock::get()?.unix_timestamp;
        require!(consumed_at <= now + 60, SigapError::FutureTimestamp);
        require!(consumed_at >= b.cooked_at, SigapError::InvalidTimestamp);
        if d.received_at == 0 {
            d.received_at = consumed_at.min(now);
        }
        d.consumed_at = consumed_at;

        // IF jam_konsumsi − jam_masak > batas SOP BGN THEN status = PERINGATAN
        let elapsed = consumed_at - b.cooked_at;
        if elapsed > (cfg.sop_max_minutes as i64) * 60 {
            d.flags |= FLAG_TIME_EXCEEDED;
            b.raise_flag(FLAG_TIME_EXCEEDED);
            emit!(TimeLimitExceeded {
                batch_id: b.batch_id.clone(),
                school: d.school,
                elapsed_minutes: (elapsed / 60) as u32,
                limit_minutes: cfg.sop_max_minutes,
            });
        }
        Ok(())
    }

    // ========================= COLD CHAIN CONTRACT ========================

    /// Sensor (atau gateway SPPG) mengunggah pembacaan suhu (buffer tiap 5 menit).
    /// Aturan "Rentang suhu" dijalankan di sini dan setiap pembacaan di-hash berantai.
    pub fn record_temperatures(ctx: Context<RecordTemperatures>, readings: Vec<TempReading>) -> Result<()> {
        require!(!readings.is_empty() && readings.len() <= MAX_READINGS_PER_TX, SigapError::TooManyReadings);
        let member = &ctx.accounts.member;
        let b = &mut ctx.accounts.batch;
        let is_owner = b.sppg == ctx.accounts.authority.key() && member.has_role(ROLE_SPPG);
        require!(is_owner || member.has_role(ROLE_SENSOR), SigapError::Unauthorized);

        let cfg = &ctx.accounts.config;
        let log = &mut ctx.accounts.temp_log;
        let now = Clock::get()?.unix_timestamp;
        let was_flagged = b.flags & FLAG_TEMP_DANGER != 0;

        for r in readings.iter() {
            require!(r.ts > b.last_temp_at, SigapError::InvalidTimestamp);
            require!(r.ts <= now + 60, SigapError::FutureTimestamp);
            require!(r.ts >= b.cooked_at - 3600, SigapError::InvalidTimestamp);

            // Akumulasi durasi di zona bahaya (interval sejak pembacaan sebelumnya)
            if b.temp_count > 0 && cfg.in_danger(b.last_temp_x10) {
                b.danger_seconds = b.danger_seconds.saturating_add((r.ts - b.last_temp_at) as u32);
            }

            // Hash berantai — bukti suhu tidak dapat diubah setelah kejadian
            b.temp_log_hash = hashv(&[
                &b.temp_log_hash[..],
                &r.ts.to_le_bytes()[..],
                &r.temp_x10.to_le_bytes()[..],
            ])
            .to_bytes();

            b.last_temp_at = r.ts;
            b.last_temp_x10 = r.temp_x10;
            b.min_temp_x10 = b.min_temp_x10.min(r.temp_x10);
            b.max_temp_x10 = b.max_temp_x10.max(r.temp_x10);
            b.temp_count = b.temp_count.saturating_add(1);

            // Ring buffer riwayat suhu terakhir
            if log.readings.len() < TEMP_LOG_CAP {
                log.readings.push(*r);
            } else {
                let h = log.head as usize;
                log.readings[h] = *r;
                log.head = ((h + 1) % TEMP_LOG_CAP) as u8;
            }
        }

        // IF suhu di zona bahaya lebih lama dari ambang THEN tandai batch & notifikasi SPPG
        if !was_flagged && b.danger_seconds > cfg.danger_max_minutes * 60 {
            b.raise_flag(FLAG_TEMP_DANGER);
            emit!(TemperatureAlert {
                batch_id: b.batch_id.clone(),
                sppg: b.sppg,
                danger_minutes: b.danger_seconds / 60,
                limit_minutes: cfg.danger_max_minutes,
            });
        }
        Ok(())
    }

    // ========================== INCIDENT CONTRACT =========================

    /// Sekolah / puskesmas melaporkan gejala — dicatat SEKALI untuk semua instansi.
    pub fn report_incident(
        ctx: Context<ReportIncident>,
        description: String,
        affected_count: u32,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        require!(description.len() <= MAX_TEXT, SigapError::TextTooLong);
        let member = &ctx.accounts.member;
        require!(member.has_role(ROLE_SEKOLAH) || member.has_role(ROLE_DINKES), SigapError::Unauthorized);

        let b = &mut ctx.accounts.batch;
        let inc = &mut ctx.accounts.incident;
        inc.batch = b.key();
        inc.index = b.incident_count;
        inc.reporter = ctx.accounts.authority.key();
        inc.description = description;
        inc.affected_count = affected_count;
        inc.evidence_hash = evidence_hash;
        inc.reported_at = Clock::get()?.unix_timestamp;
        inc.status = IncidentStatus::Dilaporkan;
        inc.verifier = Pubkey::default();
        inc.verified_at = 0;
        inc.note = String::new();
        inc.bump = ctx.bumps.incident;

        b.incident_count = b.incident_count.saturating_add(1);
        b.flags |= FLAG_INCIDENT;

        let cfg = &mut ctx.accounts.config;
        cfg.incident_count = cfg.incident_count.saturating_add(1);

        emit!(IncidentReported { batch_id: b.batch_id.clone(), index: inc.index, affected_count });
        Ok(())
    }

    /// Dinkes memverifikasi laporan. Jika terverifikasi → RecallContract membekukan batch.
    pub fn verify_incident(ctx: Context<VerifyIncident>, confirmed: bool, note: String) -> Result<()> {
        require!(note.len() <= MAX_TEXT, SigapError::TextTooLong);
        ctx.accounts.member.require_role(ROLE_DINKES)?;
        let inc = &mut ctx.accounts.incident;
        require!(inc.status == IncidentStatus::Dilaporkan, SigapError::AlreadyRecorded);

        let now = Clock::get()?.unix_timestamp;
        inc.verifier = ctx.accounts.authority.key();
        inc.verified_at = now;
        inc.note = note;

        if !confirmed {
            inc.status = IncidentStatus::Ditolak;
            return Ok(());
        }
        inc.status = IncidentStatus::Terverifikasi;

        // ---- RecallContract: IF insiden terverifikasi THEN bekukan semua batch_id yang sama
        let b = &mut ctx.accounts.batch;
        let recall = &mut ctx.accounts.recall;
        if recall.frozen_at == 0 {
            recall.batch = b.key();
            recall.batch_id = b.batch_id.clone();
            recall.trigger_incident = inc.key();
            recall.frozen_by = ctx.accounts.authority.key();
            recall.frozen_at = now;
            recall.affected_deliveries = b.delivery_count;
            recall.lab_hash = [0u8; 32];
            recall.lab_result = LabResult::Menunggu;
            recall.lab_at = 0;
            recall.bump = ctx.bumps.recall;
            let cfg = &mut ctx.accounts.config;
            cfg.recall_count = cfg.recall_count.saturating_add(1);
        }
        if b.status != BatchStatus::Ditarik {
            b.status = BatchStatus::Dibekukan;
        }
        emit!(RecallTriggered {
            batch_id: b.batch_id.clone(),
            incident: inc.key(),
            affected_deliveries: b.delivery_count,
        });
        Ok(())
    }

    // =========================== RECALL CONTRACT ==========================

    /// BPOM mengunggah hash hasil uji lab sampel retain (dokumen disimpan off-chain / IPFS).
    pub fn submit_lab_result(ctx: Context<SubmitLabResult>, result_hash: [u8; 32], contaminated: bool) -> Result<()> {
        ctx.accounts.member.require_role(ROLE_BPOM)?;
        let recall = &mut ctx.accounts.recall;
        require!(recall.lab_result == LabResult::Menunggu, SigapError::AlreadyRecorded);
        let b = &mut ctx.accounts.batch;

        recall.lab_hash = result_hash;
        recall.lab_at = Clock::get()?.unix_timestamp;
        b.lab_hash = result_hash;
        if contaminated {
            recall.lab_result = LabResult::Terkontaminasi;
            b.status = BatchStatus::Ditarik;
        } else {
            recall.lab_result = LabResult::Aman;
            b.status = BatchStatus::Dibebaskan;
        }
        emit!(LabResultSubmitted { batch_id: b.batch_id.clone(), contaminated });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Akun
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Batas SOP jam masak → jam konsumsi (menit)
    pub sop_max_minutes: u32,
    /// Zona bahaya suhu (°C x10), mis. 50 = 5,0°C dan 600 = 60,0°C
    pub danger_min_x10: i16,
    pub danger_max_x10: i16,
    /// Lama maksimum kumulatif di zona bahaya (menit)
    pub danger_max_minutes: u32,
    pub batch_count: u64,
    pub incident_count: u64,
    pub recall_count: u64,
    pub bump: u8,
}

impl Config {
    fn apply(&mut self, p: &ConfigParams) {
        self.sop_max_minutes = p.sop_max_minutes;
        self.danger_min_x10 = p.danger_min_x10;
        self.danger_max_x10 = p.danger_max_x10;
        self.danger_max_minutes = p.danger_max_minutes;
    }
    pub fn in_danger(&self, t: i16) -> bool {
        t > self.danger_min_x10 && t < self.danger_max_x10
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigParams {
    pub sop_max_minutes: u32,
    pub danger_min_x10: i16,
    pub danger_max_x10: i16,
    pub danger_max_minutes: u32,
}

impl ConfigParams {
    fn validate(&self) -> Result<()> {
        require!(self.sop_max_minutes > 0 && self.danger_max_minutes > 0, SigapError::InvalidConfig);
        require!(self.danger_min_x10 < self.danger_max_x10, SigapError::InvalidConfig);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Member {
    pub wallet: Pubkey,
    #[max_len(MAX_NAME)]
    pub name: String,
    pub roles: u8,
    pub active: bool,
    pub bump: u8,
}

impl Member {
    pub fn has_role(&self, role: u8) -> bool {
        self.active && (self.roles & role) != 0
    }
    pub fn require_role(&self, role: u8) -> Result<()> {
        require!(self.has_role(role), SigapError::Unauthorized);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum BatchStatus {
    Diproduksi,
    Dikirim,
    Peringatan,
    Dibekukan,
    Ditarik,
    Dibebaskan,
}

#[account]
#[derive(InitSpace)]
pub struct Batch {
    #[max_len(MAX_ID)]
    pub batch_id: String,
    pub sppg: Pubkey,
    #[max_len(MAX_NAME)]
    pub menu: String,
    #[max_len(MAX_NAME)]
    pub supplier: String,
    pub ingredients_expiry: i64,
    pub cooked_at: i64,
    #[max_len(MAX_ID)]
    pub retain_sample_id: String,
    pub portions: u32,
    pub created_at: i64,
    pub status: BatchStatus,
    pub flags: u8,
    pub delivery_count: u32,
    pub incident_count: u32,
    // --- cold chain ---
    pub temp_count: u32,
    pub last_temp_at: i64,
    pub last_temp_x10: i16,
    pub min_temp_x10: i16,
    pub max_temp_x10: i16,
    pub danger_seconds: u32,
    pub temp_log_hash: [u8; 32],
    // --- recall ---
    pub lab_hash: [u8; 32],
    pub bump: u8,
}

impl Batch {
    pub fn is_frozen(&self) -> bool {
        matches!(self.status, BatchStatus::Dibekukan | BatchStatus::Ditarik)
    }
    fn raise_flag(&mut self, flag: u8) {
        self.flags |= flag;
        if matches!(self.status, BatchStatus::Diproduksi | BatchStatus::Dikirim) {
            self.status = BatchStatus::Peringatan;
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct TempReading {
    pub ts: i64,
    pub temp_x10: i16,
}

#[account]
#[derive(InitSpace)]
pub struct TempLog {
    pub batch: Pubkey,
    pub head: u8,
    #[max_len(TEMP_LOG_CAP)]
    pub readings: Vec<TempReading>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Delivery {
    pub batch: Pubkey,
    pub school: Pubkey,
    pub portions: u32,
    pub dispatched_at: i64,
    pub received_at: i64,
    pub consumed_at: i64,
    pub flags: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum IncidentStatus {
    Dilaporkan,
    Terverifikasi,
    Ditolak,
}

#[account]
#[derive(InitSpace)]
pub struct Incident {
    pub batch: Pubkey,
    pub index: u32,
    pub reporter: Pubkey,
    #[max_len(MAX_TEXT)]
    pub description: String,
    pub affected_count: u32,
    pub evidence_hash: [u8; 32],
    pub reported_at: i64,
    pub status: IncidentStatus,
    pub verifier: Pubkey,
    pub verified_at: i64,
    #[max_len(MAX_TEXT)]
    pub note: String,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LabResult {
    Menunggu,
    Aman,
    Terkontaminasi,
}

#[account]
#[derive(InitSpace)]
pub struct Recall {
    pub batch: Pubkey,
    #[max_len(MAX_ID)]
    pub batch_id: String,
    pub trigger_incident: Pubkey,
    pub frozen_by: Pubkey,
    pub frozen_at: i64,
    pub affected_deliveries: u32,
    pub lab_hash: [u8; 32],
    pub lab_result: LabResult,
    pub lab_at: i64,
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Konteks instruksi
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ SigapError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct SetMember<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ SigapError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + Member::INIT_SPACE,
        seeds = [b"member", wallet.as_ref()],
        bump
    )]
    pub member: Account<'info, Member>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(batch_id: String)]
pub struct CreateBatch<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(
        init,
        payer = authority,
        space = 8 + Batch::INIT_SPACE,
        seeds = [b"batch", batch_id.as_bytes()],
        bump
    )]
    pub batch: Account<'info, Batch>,
    #[account(
        init,
        payer = authority,
        space = 8 + TempLog::INIT_SPACE,
        seeds = [b"templog", batch.key().as_ref()],
        bump
    )]
    pub temp_log: Account<'info, TempLog>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(school: Pubkey)]
pub struct DispatchBatch<'info> {
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(mut, seeds = [b"batch", batch.batch_id.as_bytes()], bump = batch.bump)]
    pub batch: Account<'info, Batch>,
    #[account(
        init,
        payer = authority,
        space = 8 + Delivery::INIT_SPACE,
        seeds = [b"delivery", batch.key().as_ref(), school.as_ref()],
        bump
    )]
    pub delivery: Account<'info, Delivery>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SchoolAction<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(mut, seeds = [b"batch", batch.batch_id.as_bytes()], bump = batch.bump)]
    pub batch: Account<'info, Batch>,
    #[account(
        mut,
        seeds = [b"delivery", batch.key().as_ref(), authority.key().as_ref()],
        bump = delivery.bump,
        constraint = delivery.school == authority.key() @ SigapError::Unauthorized
    )]
    pub delivery: Account<'info, Delivery>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordTemperatures<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(mut, seeds = [b"batch", batch.batch_id.as_bytes()], bump = batch.bump)]
    pub batch: Account<'info, Batch>,
    #[account(mut, seeds = [b"templog", batch.key().as_ref()], bump = temp_log.bump)]
    pub temp_log: Account<'info, TempLog>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReportIncident<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(mut, seeds = [b"batch", batch.batch_id.as_bytes()], bump = batch.bump)]
    pub batch: Account<'info, Batch>,
    #[account(
        init,
        payer = authority,
        space = 8 + Incident::INIT_SPACE,
        seeds = [b"incident", batch.key().as_ref(), &batch.incident_count.to_le_bytes()],
        bump
    )]
    pub incident: Account<'info, Incident>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyIncident<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(mut, seeds = [b"batch", batch.batch_id.as_bytes()], bump = batch.bump)]
    pub batch: Account<'info, Batch>,
    #[account(
        mut,
        seeds = [b"incident", batch.key().as_ref(), &incident.index.to_le_bytes()],
        bump = incident.bump,
        has_one = batch
    )]
    pub incident: Account<'info, Incident>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + Recall::INIT_SPACE,
        seeds = [b"recall", batch.key().as_ref()],
        bump
    )]
    pub recall: Account<'info, Recall>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitLabResult<'info> {
    #[account(seeds = [b"member", authority.key().as_ref()], bump = member.bump)]
    pub member: Account<'info, Member>,
    #[account(mut, seeds = [b"batch", batch.batch_id.as_bytes()], bump = batch.bump)]
    pub batch: Account<'info, Batch>,
    #[account(mut, seeds = [b"recall", batch.key().as_ref()], bump = recall.bump, has_one = batch)]
    pub recall: Account<'info, Recall>,
    pub authority: Signer<'info>,
}

// ---------------------------------------------------------------------------
// Event (notifikasi untuk dashboard)
// ---------------------------------------------------------------------------

#[event]
pub struct MemberUpdated {
    pub wallet: Pubkey,
    pub roles: u8,
}
#[event]
pub struct BatchCreated {
    pub batch_id: String,
    pub sppg: Pubkey,
    pub cooked_at: i64,
}
#[event]
pub struct BatchDispatched {
    pub batch_id: String,
    pub school: Pubkey,
    pub portions: u32,
}
#[event]
pub struct TimeLimitExceeded {
    pub batch_id: String,
    pub school: Pubkey,
    pub elapsed_minutes: u32,
    pub limit_minutes: u32,
}
#[event]
pub struct TemperatureAlert {
    pub batch_id: String,
    pub sppg: Pubkey,
    pub danger_minutes: u32,
    pub limit_minutes: u32,
}
#[event]
pub struct IncidentReported {
    pub batch_id: String,
    pub index: u32,
    pub affected_count: u32,
}
#[event]
pub struct RecallTriggered {
    pub batch_id: String,
    pub incident: Pubkey,
    pub affected_deliveries: u32,
}
#[event]
pub struct LabResultSubmitted {
    pub batch_id: String,
    pub contaminated: bool,
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[error_code]
pub enum SigapError {
    #[msg("Wallet tidak memiliki peran yang dibutuhkan")]
    Unauthorized,
    #[msg("ID tidak valid (1-32 karakter)")]
    InvalidId,
    #[msg("Teks terlalu panjang")]
    TextTooLong,
    #[msg("Konfigurasi tidak valid")]
    InvalidConfig,
    #[msg("Waktu berada di masa depan")]
    FutureTimestamp,
    #[msg("Waktu terlalu lampau")]
    TimestampTooOld,
    #[msg("Waktu tidak valid / tidak berurutan")]
    InvalidTimestamp,
    #[msg("Bahan baku sudah kedaluwarsa saat dimasak")]
    IngredientExpired,
    #[msg("Hanya SPPG pemilik batch yang boleh melakukan ini")]
    NotBatchOwner,
    #[msg("Batch DIBEKUKAN (recall) — jangan dikonsumsi")]
    BatchFrozen,
    #[msg("Data sudah tercatat sebelumnya")]
    AlreadyRecorded,
    #[msg("Jumlah pembacaan suhu per transaksi 1-24")]
    TooManyReadings,
}
