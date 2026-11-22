-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('draft', 'open', 'closed');

-- CreateEnum
CREATE TYPE "LinkType" AS ENUM ('public', 'inviter', 'door');

-- CreateEnum
CREATE TYPE "GuestType" AS ENUM ('guest', 'crew');

-- CreateEnum
CREATE TYPE "GuestStatus" AS ENUM ('pending_email', 'requested', 'waitlisted', 'rejected', 'approved_unpaid', 'payment_mismatch', 'paid', 'checked_in', 'checked_out', 'expired', 'cancelled', 'replaced');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('login', 'confirm_booking');

-- CreateEnum
CREATE TYPE "NameChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('email', 'csv', 'imap', 'manual');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('matched', 'suggested', 'unmatched', 'late', 'refund_due', 'refunded');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('reference', 'unique_amount', 'name_amount', 'manual');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('due', 'refunded');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('admin', 'door', 'guest', 'system');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "bookingId" TEXT,
    "redirect" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3),
    "paymentsAcceptedUntil" TIMESTAMP(3),
    "paymentDeadlineMinutes" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER NOT NULL DEFAULT 250,
    "feeCents" INTEGER NOT NULL,
    "maxGroupSize" INTEGER NOT NULL DEFAULT 5,
    "city" TEXT,
    "address" TEXT,
    "directions" TEXT,
    "info" TEXT,
    "transparencyPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyCost" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyLink" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "type" "LinkType" NOT NULL,
    "code" TEXT NOT NULL,
    "inviterLabel" TEXT,
    "pinHash" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "PartyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "accountId" TEXT,
    "email" TEXT NOT NULL,
    "bookerName" TEXT NOT NULL,
    "bookerAttends" BOOLEAN NOT NULL DEFAULT true,
    "viaLinkId" TEXT,
    "referenceCode" TEXT NOT NULL,
    "lockedAmountCents" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "paymentDeadline" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "bookingId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "isBooker" BOOLEAN NOT NULL DEFAULT false,
    "adultConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "type" "GuestType" NOT NULL DEFAULT 'guest',
    "role" TEXT,
    "status" "GuestStatus" NOT NULL DEFAULT 'pending_email',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketToken" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "checkedInDevice" TEXT,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NameChangeRequest" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "newName" TEXT NOT NULL,
    "newEmail" TEXT,
    "adultConfirmed" BOOLEAN NOT NULL,
    "status" "NameChangeStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "NameChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "messageId" TEXT,
    "fromAddr" TEXT,
    "subject" TEXT,
    "raw" TEXT NOT NULL,
    "dkimValid" BOOLEAN NOT NULL DEFAULT false,
    "dkimDomain" TEXT,
    "kind" TEXT,
    "parsedAt" TIMESTAMP(3),
    "parseError" TEXT,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paypalTxId" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "feeCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "senderName" TEXT,
    "senderEmail" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3),
    "source" "PaymentSource" NOT NULL,
    "inboundEmailId" TEXT,
    "matchedBookingId" TEXT,
    "matchType" "MatchType",
    "state" "PaymentState" NOT NULL,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT,
    "paymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'due',
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Blocklist" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Blocklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoorDevice" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "offlinePrimary" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoorDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "ActorType" NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "partyId" TEXT,
    "data" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_accountId_idx" ON "Session"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_tokenHash_key" ON "LoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginToken_email_createdAt_idx" ON "LoginToken"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Party_slug_key" ON "Party"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PartyLink_code_key" ON "PartyLink"("code");

-- CreateIndex
CREATE INDEX "PartyLink_partyId_type_idx" ON "PartyLink"("partyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_referenceCode_key" ON "Booking"("referenceCode");

-- CreateIndex
CREATE INDEX "Booking_partyId_idx" ON "Booking"("partyId");

-- CreateIndex
CREATE INDEX "Booking_accountId_idx" ON "Booking"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_ticketToken_key" ON "Guest"("ticketToken");

-- CreateIndex
CREATE INDEX "Guest_partyId_status_idx" ON "Guest"("partyId", "status");

-- CreateIndex
CREATE INDEX "Guest_bookingId_idx" ON "Guest"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_messageId_key" ON "InboundEmail"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paypalTxId_key" ON "Payment"("paypalTxId");

-- CreateIndex
CREATE UNIQUE INDEX "DoorDevice_tokenHash_key" ON "DoorDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditLog_partyId_createdAt_idx" ON "AuditLog"("partyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyCost" ADD CONSTRAINT "PartyCost_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyLink" ADD CONSTRAINT "PartyLink_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_viaLinkId_fkey" FOREIGN KEY ("viaLinkId") REFERENCES "PartyLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NameChangeRequest" ADD CONSTRAINT "NameChangeRequest_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_inboundEmailId_fkey" FOREIGN KEY ("inboundEmailId") REFERENCES "InboundEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_matchedBookingId_fkey" FOREIGN KEY ("matchedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorDevice" ADD CONSTRAINT "DoorDevice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoorDevice" ADD CONSTRAINT "DoorDevice_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "PartyLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
