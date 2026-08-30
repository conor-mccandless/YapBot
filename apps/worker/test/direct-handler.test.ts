import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectInteractionLimiter } from "@yapbot/domain";
import {
  handleDirectInteraction,
  type DirectServices,
} from "../src/direct-handler.js";
import {
  bot,
  freddy,
  history,
  msg,
  request,
  steve,
} from "./direct-fixtures.js";

function services(): DirectServices {
  return {
    botId: bot.id,
    limiter: new DirectInteractionLimiter(),
    cooldownSeconds: 30,
    contextMinutes: 180,
    dailyLimit: 50,
    repository: {
      tryReserveDirectGeneration: vi.fn().mockResolvedValue(true),
      getUserPersona: vi.fn().mockResolvedValue(undefined),
    },
    model: vi
      .fn()
      .mockResolvedValue({ status: "completed", text: "Coffee isn't lunch." }),
    fetchHistory: vi.fn().mockResolvedValue(history),
    fetchReply: vi.fn().mockResolvedValue(undefined),
    fetchMessage: vi.fn(),
    canSend: vi.fn().mockResolvedValue(true),
    sendReply: vi.fn(),
    log: vi.fn(),
    now: () => 1000,
  };
}
afterEach(() => vi.useRealTimers());

describe("direct orchestration", () => {
  it("distinguishes a quota backend failure from actual exhaustion", async () => {
    const service = services();
    vi.mocked(service.repository.tryReserveDirectGeneration).mockRejectedValue(
      new Error("database unavailable"),
    );
    await handleDirectInteraction(request("hi"), service);
    expect(service.model).not.toHaveBeenCalled();
    expect(service.log).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "quota_reservation_failed" }),
    );
    expect(service.sendReply).toHaveBeenCalledWith(
      expect.stringContaining("snag"),
    );
  });
  it("answers an unmonitored observer using both speakers without requester persona", async () => {
    const service = services();
    await handleDirectInteraction(request("what's going on?"), service);
    expect(service.sendReply).toHaveBeenCalledWith("Coffee isn't lunch.");
    expect(service.repository.getUserPersona).not.toHaveBeenCalled();
    const context = vi.mocked(service.model!).mock.calls[0]![0];
    expect(context.recentConversation.map((m) => m.author.id)).toEqual([
      freddy.id,
      steve.id,
    ]);
    expect(service.repository.tryReserveDirectGeneration).toHaveBeenCalledWith(
      "g",
      50,
    );
  });
  it("loads only the named subject's optional persona", async () => {
    const service = services();
    vi.mocked(service.repository.getUserPersona).mockResolvedValue({
      description: "coffee snob",
    } as never);
    await handleDirectInteraction(
      request("what do you think of Freddy?"),
      service,
    );
    expect(service.repository.getUserPersona).toHaveBeenCalledWith(
      "g",
      freddy.id,
    );
    expect(vi.mocked(service.model!).mock.calls[0]![0].subjectPersonas).toEqual(
      [{ userId: freddy.id, description: "coffee snob" }],
    );
  });
  it("does not consume quota for deterministic ambiguity clarification", async () => {
    const service = services();
    vi.mocked(service.fetchHistory).mockResolvedValue([
      ...history,
      msg("ff", "hey", { ...steve, displayName: "Freddy" }),
    ]);
    await handleDirectInteraction(request("what about Freddy?"), service);
    expect(
      service.repository.tryReserveDirectGeneration,
    ).not.toHaveBeenCalled();
    expect(service.model).not.toHaveBeenCalled();
    expect(service.sendReply).toHaveBeenCalledWith(
      expect.stringContaining("multiple"),
    );
  });
  it("deduplicates requests and does not fetch history for rejected admission", async () => {
    const service = services();
    await handleDirectInteraction(request("hi"), service);
    await handleDirectInteraction(request("hi"), service);
    await handleDirectInteraction(
      request("hi again", { id: "second" }),
      service,
    );
    expect(service.sendReply).toHaveBeenCalledTimes(1);
    expect(service.fetchHistory).toHaveBeenCalledTimes(1);
  });
  it("cancels a pending send on configuration change", async () => {
    const service = services();
    service.model = vi.fn(async () => {
      service.limiter.clearGuild("g");
      return { status: "completed", text: "no" };
    });
    await handleDirectInteraction(request("hi"), service);
    expect(service.sendReply).not.toHaveBeenCalled();
    expect(service.log).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "cancelled_configuration_changed" }),
    );
  });
  it("rechecks scope before sending", async () => {
    const service = services();
    vi.mocked(service.canSend).mockResolvedValue(false);
    await handleDirectInteraction(request("hi"), service);
    expect(service.sendReply).not.toHaveBeenCalled();
  });
  it("degrades safely when channel history or reply cannot be fetched", async () => {
    const service = services();
    vi.mocked(service.fetchHistory).mockRejectedValue(new Error("403"));
    vi.mocked(service.fetchReply).mockRejectedValue(new Error("404"));
    await handleDirectInteraction(request("what's going on?"), service);
    expect(
      vi.mocked(service.model!).mock.calls[0]![0].contextLimitations.length,
    ).toBeGreaterThan(1);
    expect(service.sendReply).toHaveBeenCalledTimes(1);
  });
  it("bounds a never-resolving history fetch", async () => {
    vi.useFakeTimers();
    const service = services();
    service.fetchHistory = vi.fn(() => new Promise(() => undefined));
    const pending = handleDirectInteraction(request("hi"), service);
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    expect(service.sendReply).toHaveBeenCalledTimes(1);
  });
  it("does not generate or fetch images when direct quota is exhausted", async () => {
    const service = services();
    vi.mocked(service.repository.tryReserveDirectGeneration).mockResolvedValue(
      false,
    );
    await handleDirectInteraction(
      request("look https://example.com/image.png"),
      service,
    );
    expect(service.model).not.toHaveBeenCalled();
    expect(service.fetchMessage).not.toHaveBeenCalled();
    expect(service.sendReply).toHaveBeenCalledWith(
      expect.stringContaining("budget"),
    );
  });
  it("maps a direct image to its source and passes downloaded bytes to the model", async () => {
    const service = services();
    const image = {
      contentType: "image/png",
      size: 3,
      url: "https://cdn.discordapp.com/attachments/1/2/image.png",
    };
    service.downloadImages = vi.fn().mockResolvedValue([
      {
        dataUrl: "data:image/png;base64,YQ==",
        sourceMessageId: "r",
        sourceAttachmentSequence: 1,
      },
    ]);
    await handleDirectInteraction(
      request("what is this?", { images: [image], declaredImageCount: 1 }),
      service,
    );
    expect(
      vi.mocked(service.model!).mock.calls[0]![0].images[0]?.sourceMessageId,
    ).toBe("r");
    expect(service.downloadImages).toHaveBeenCalledWith([
      expect.objectContaining({ sourceMessageId: "r" }),
    ]);
  });
});
