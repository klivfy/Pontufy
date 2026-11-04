-- ═══════════════════════════════════════════════════════════════════════════
-- Certificado: persistir o PAYLOAD CANÔNICO que foi assinado.
--
-- Antes, o emissor assinava `completionDate` (data da última conclusão),
-- `workloadHours` e `lessonCount` reais, mas a página pública de verificação
-- reconstruía o payload com `completionDate = issuedAt` e
-- `workloadHours: 0, lessonCount: 0` — resultado: TODO certificado legítimo
-- aparecia como "Certificado Inválido".
--
-- Guardar a string exata elimina a reconstrução: a verificação recalcula o
-- HMAC sobre os mesmos bytes. TEXT (e não JSONB) porque o jsonb reordena
-- chaves e quebraria a assinatura.
--
-- Certificados emitidos antes desta migração ficam com `signedPayload` NULL e
-- passam a ser reportados como "emitido antes da verificação criptográfica"
-- (não como fraude).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "IssuedCertificate" ADD COLUMN "signedPayload" TEXT;
