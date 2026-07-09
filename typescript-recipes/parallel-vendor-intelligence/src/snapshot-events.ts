import { z } from "zod";

import type { FieldBasis } from "./parallel-port.js";
import {
  EvidenceFieldSchema,
  VendorReportSchema,
  type EvidenceField,
  type VendorReport,
} from "./schema.js";
import {
  FieldBasisSchema,
  RawSnapshotEventSchema,
  type RawSnapshotEvent,
} from "./state.js";

export interface SnapshotEventInput {
  event_id: string;
  event_group_id: string;
  event_date: string | null;
  previous_output: { type: unknown; content: unknown; basis: unknown };
  changed_output: { type: unknown; content: unknown; basis: unknown };
}

export class InvalidSnapshotEventError extends Error {
  constructor(
    readonly eventId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InvalidSnapshotEventError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBasis(value: unknown): FieldBasis[] {
  return FieldBasisSchema.array().parse(value ?? []);
}

export function rawSnapshotEvent(event: SnapshotEventInput): RawSnapshotEvent {
  return RawSnapshotEventSchema.parse({
    eventId: event.event_id,
    eventGroupId: event.event_group_id,
    eventDate: event.event_date,
    previousOutput: event.previous_output,
    changedOutput: event.changed_output,
  });
}

export function restoredSnapshotEvent(event: RawSnapshotEvent): SnapshotEventInput {
  return {
    event_id: event.eventId,
    event_group_id: event.eventGroupId,
    event_date: event.eventDate,
    previous_output: event.previousOutput,
    changed_output: event.changedOutput,
  };
}

/** Validate a partial snapshot and replace changed top-level evidence atomically. */
export function reconstructSnapshotEvent(event: SnapshotEventInput): {
  previousReport: VendorReport;
  currentReport: VendorReport;
  previousBasis: FieldBasis[];
  currentBasis: FieldBasis[];
  changedFields: EvidenceField[];
} {
  try {
    if (event.previous_output.type !== "json" || event.changed_output.type !== "json") {
      throw new Error("Snapshot outputs must both be JSON.");
    }

    const previousContent = z
      .record(z.string(), z.unknown())
      .parse(event.previous_output.content);
    const changedContent = z
      .record(z.string(), z.unknown())
      .parse(event.changed_output.content);
    const previousReport = VendorReportSchema.parse(previousContent);
    const changedFields = z
      .array(EvidenceFieldSchema)
      .parse(Object.keys(changedContent));
    const currentReport = VendorReportSchema.parse({
      ...previousContent,
      ...changedContent,
    });

    const previousBasis = parseBasis(event.previous_output.basis);
    const basis = new Map<string, FieldBasis>();
    for (const entry of previousBasis) basis.set(entry.field, entry);
    for (const field of changedFields) {
      basis.delete(field);
      for (const existingField of [...basis.keys()]) {
        if (existingField.startsWith(`${field}.`)) basis.delete(existingField);
      }
    }
    for (const entry of parseBasis(event.changed_output.basis)) basis.set(entry.field, entry);

    return {
      previousReport,
      currentReport,
      previousBasis,
      currentBasis: [...basis.values()],
      changedFields,
    };
  } catch (error) {
    throw new InvalidSnapshotEventError(
      event.event_id,
      `Snapshot event ${event.event_id} is invalid: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}
