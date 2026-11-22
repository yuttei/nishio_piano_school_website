import siteContent from "virtual:site-content";
import {
  DAYS,
  STATUSES,
  homePhotoLabels,
  homePhotoSlots,
  type Photo,
  type SchoolEvent,
  type Status,
} from "./content.ts";
import {
  readAddedEvents,
  readAvailability,
  readDemoEvents,
  readDemoHomePhotos,
  saveAddedEvents,
  saveAvailability,
  saveDemoEventEdit,
  saveDemoEventPhoto,
  saveDemoHomePhoto,
} from "./demo-storage.ts";

// 空き状況の時間帯（午前・午後）は、内容フォルダの site.json から受け取ります。
const TIME_SLOTS = siteContent.site.timeSlots;

const MAX_PHOTO_SIDE = 1200;

function showResult(element: HTMLElement, message: string, isError = false): void {
  element.toggleAttribute("data-error", isError);
  element.textContent = message;
}

function setupAvailabilityEditor(): void {
  const form = document.querySelector<HTMLFormElement>("#availability-editor");
  const fields = document.querySelector<HTMLElement>("#availability-fields");
  const result = document.querySelector<HTMLElement>("#availability-status");
  if (!form || !fields || !result) return;

  const availability = readAvailability();

  // 画面は曜日ごとに並べ、保存データは時間帯ごとの行にまとめます。
  DAYS.forEach((day, dayIndex) => {
    const group = document.createElement("fieldset");
    group.className = "editor-day";
    const heading = document.createElement("legend");
    heading.textContent = day + "曜日";
    group.append(heading);

    TIME_SLOTS.forEach((time, timeIndex) => {
      const label = document.createElement("label");
      label.textContent = time;

      const select = document.createElement("select");
      select.name = "slot-" + timeIndex + "-" + dayIndex;
      for (const status of STATUSES) {
        select.add(new Option(status, status));
      }
      select.value = availability.rows[timeIndex][dayIndex];
      label.append(select);
      group.append(label);
    });

    fields.append(group);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const rows: Status[][] = [];

    for (const timeIndex of TIME_SLOTS.keys()) {
      const row: Status[] = [];
      for (const dayIndex of DAYS.keys()) {
        const value = formData.get("slot-" + timeIndex + "-" + dayIndex);
        const status = STATUSES.find((option) => option === value);
        if (!status) {
          showResult(result, "すべての時間帯の空き状況を選んでください。", true);
          return;
        }
        row.push(status);
      }
      rows.push(row);
    }

    try {
      saveAvailability({ rows, updatedAt: new Date().toISOString() });
      showResult(result, "空き状況を保存しました。");
    } catch {
      showResult(result, "保存できませんでした。ブラウザーの保存設定をご確認ください。", true);
    }
  });
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("画像を読み込めませんでした。"));
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function resizePhoto(file: File): Promise<string> {
  const photo = new Image();
  photo.src = await readImageFile(file);
  await photo.decode();

  // ブラウザーに保存する写真は、長い辺を縮小して容量を抑えます。
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(photo.naturalWidth, photo.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
  const drawing = canvas.getContext("2d");
  if (!drawing) throw new Error("写真を変換できませんでした。");

  drawing.fillStyle = "white";
  drawing.fillRect(0, 0, canvas.width, canvas.height);
  drawing.drawImage(photo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function setupPhotoPreview(photoInput: HTMLInputElement, photoPreview: HTMLImageElement): () => void {
  let previewUrl: string | undefined;
  const clearPreview = (): void => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    photoPreview.hidden = true;
    photoPreview.removeAttribute("src");
  };

  photoInput.addEventListener("change", () => {
    clearPreview();
    const file = photoInput.files?.[0];
    if (!file) return;

    previewUrl = URL.createObjectURL(file);
    photoPreview.src = previewUrl;
  });

  photoPreview.addEventListener("load", () => {
    photoPreview.hidden = false;
  });
  photoPreview.addEventListener("error", clearPreview);

  return clearPreview;
}

function showSavedPhoto(image: HTMLImageElement, empty: HTMLElement, photo?: Photo): void {
  image.hidden = !photo?.image;
  empty.hidden = !!photo?.image;
  if (photo?.image) {
    image.src = photo.image;
    image.alt = photo.imageAlt;
  } else {
    image.removeAttribute("src");
  }
}

// イベント写真の説明（代替テキスト）を決めます。
// 入力欄の値をそのまま使い、空なら「見出し＋の写真」で補います。
// 写真がある限り、新規追加・既存の編集・新しい写真の選択のどれでもこの規則を使います。
function eventPhotoAlt(imageAlt: string, title: string): string {
  return imageAlt || title + "の写真";
}

function isSamePhoto(first?: Photo, second?: Photo): boolean {
  return first?.image === second?.image && first?.imageAlt === second?.imageAlt;
}

interface PhotoTarget {
  photo: Photo;
  reviewUrl: string;
  reviewLabel: string;
  save: (photo: Photo) => void;
}

function setupPhotoEditor(onPhotoSaved: () => void): () => void {
  const form = document.querySelector<HTMLFormElement>("#photo-editor");
  const targetInput = document.querySelector<HTMLSelectElement>("#replacement-target");
  const currentField = document.querySelector<HTMLElement>("#replacement-current");
  const currentPreview = document.querySelector<HTMLImageElement>("#replacement-current-photo");
  const noPhoto = document.querySelector<HTMLElement>("#replacement-no-photo");
  const photoInput = document.querySelector<HTMLInputElement>("#replacement-photo");
  const photoPreview = document.querySelector<HTMLImageElement>("#replacement-photo-preview");
  const altInput = document.querySelector<HTMLInputElement>("#replacement-alt");
  const review = document.querySelector<HTMLAnchorElement>("#replacement-review");
  const result = document.querySelector<HTMLElement>("#replacement-status");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !targetInput || !currentField || !currentPreview || !noPhoto || !photoInput || !photoPreview || !altInput || !review || !result || !button) {
    return () => {};
  }

  const targets = new Map<string, PhotoTarget>();
  const clearPreview = setupPhotoPreview(photoInput, photoPreview);

  const showCurrentPhoto = (syncAlt: boolean): void => {
    const target = targets.get(targetInput.value);
    currentField.hidden = !target;
    showSavedPhoto(currentPreview, noPhoto, target?.photo);
    if (syncAlt) altInput.value = target?.photo.imageAlt ?? "";
    review.hidden = !target;
    if (target) {
      review.href = target.reviewUrl;
      review.textContent = target.reviewLabel;
    }
  };

  const refreshTargets = (): void => {
    const selected = targetInput.value;
    const savedAlt = targets.get(selected)?.photo.imageAlt ?? "";
    const home = document.createElement("optgroup");
    const events = document.createElement("optgroup");
    const homePhotos = readDemoHomePhotos();
    home.label = "トップページ";
    events.label = "イベント";
    targets.clear();

    for (const slot of homePhotoSlots) {
      const key = `home:${slot}`;
      home.append(new Option(homePhotoLabels[slot], key));
      targets.set(key, {
        photo: homePhotos[slot],
        reviewUrl: "/",
        reviewLabel: "トップページを確認",
        save: (photo) => saveDemoHomePhoto(slot, photo),
      });
    }
    for (const event of readDemoEvents()) {
      const key = `event:${event.id}`;
      events.append(new Option(event.title, key));
      targets.set(key, {
        photo: event,
        reviewUrl: "/events/",
        reviewLabel: "イベントを確認",
        save: (photo) => saveDemoEventPhoto(event.id, photo),
      });
    }

    const placeholder = new Option("差し替える場所を選択", "");
    placeholder.disabled = true;
    targetInput.replaceChildren(placeholder, home, events);
    targetInput.value = targets.has(selected) ? selected : "";
    showCurrentPhoto(altInput.value === savedAlt);
  };

  refreshTargets();
  targetInput.addEventListener("change", () => {
    photoInput.value = "";
    clearPreview();
    showCurrentPhoto(true);
    showResult(result, "");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;

    const targetKey = targetInput.value;
    const target = targets.get(targetKey);
    const file = photoInput.files?.[0];
    const imageAlt = altInput.value.trim();
    if (!target || !file || !imageAlt) {
      showResult(result, "差し替える場所と新しい写真を選び、写真の説明を入力してください。", true);
      return;
    }

    const controls = [targetInput, photoInput, altInput, button];
    controls.forEach((control) => { control.disabled = true; });
    try {
      let image: string;
      try {
        image = await resizePhoto(file);
      } catch {
        showResult(result, "写真を読み込めませんでした。JPEGやPNGの写真をお試しください。", true);
        return;
      }

      // 画像の読み込み中に別のフォームで写真が更新された場合、後から届いた変更を残します。
      refreshTargets();
      if (!isSamePhoto(target.photo, targets.get(targetKey)?.photo)) {
        showResult(result, "写真が更新されました。現在の写真を確認してから、もう一度保存してください。", true);
        return;
      }

      target.save({ image, imageAlt });
      photoInput.value = "";
      clearPreview();
      refreshTargets();
      showCurrentPhoto(true);
      onPhotoSaved();
      showResult(result, "写真を差し替えました。");
    } catch {
      showResult(result, "保存できませんでした。写真のサイズやブラウザーの空き容量をご確認ください。", true);
    } finally {
      controls.forEach((control) => { control.disabled = false; });
    }
  });

  return refreshTargets;
}

function setupEventEditor(onEventSaved: () => void): () => void {
  const form = document.querySelector<HTMLFormElement>("#event-editor");
  const targetInput = document.querySelector<HTMLSelectElement>("#event-target");
  const titleInput = document.querySelector<HTMLInputElement>("#event-title");
  const monthInput = document.querySelector<HTMLInputElement>("#event-month");
  const descriptionInput = document.querySelector<HTMLTextAreaElement>("#event-description");
  const currentField = document.querySelector<HTMLElement>("#event-current");
  const currentPreview = document.querySelector<HTMLImageElement>("#event-current-photo");
  const noPhoto = document.querySelector<HTMLElement>("#event-no-photo");
  const photoInput = document.querySelector<HTMLInputElement>("#event-photo");
  const photoPreview = document.querySelector<HTMLImageElement>("#event-photo-preview");
  const altInput = document.querySelector<HTMLInputElement>("#event-photo-alt");
  const result = document.querySelector<HTMLElement>("#event-status");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!form || !targetInput || !titleInput || !monthInput || !descriptionInput || !currentField || !currentPreview || !noPhoto || !photoInput || !photoPreview || !altInput || !result || !button) {
    return () => {};
  }

  const clearPreview = setupPhotoPreview(photoInput, photoPreview);
  let events: SchoolEvent[] = [];

  const findSelectedEvent = () => events.find((event) => event.id === targetInput.value);

  // 写真がないとき（選択中のイベントに写真がなく、新しい写真も選んでいないとき）は、
  // 説明を入力しても使い道がないので、説明欄を入力できないようにします。
  const updateAltInput = (): void => {
    // 保存中は全入力欄を止めているので触らず、保存の終了後に呼び直します。
    if (button.disabled) return;
    const hasPhoto = !!photoInput.files?.[0] || !!findSelectedEvent()?.image;
    altInput.disabled = !hasPhoto;
    altInput.placeholder = hasPhoto ? "空欄なら「（見出し）の写真」になります" : "写真があるときに入力できます";
  };

  const showCurrentPhoto = (event?: SchoolEvent): void => {
    currentField.hidden = !event;
    showSavedPhoto(currentPreview, noPhoto, event);
    updateAltInput();
  };

  const refreshTargets = (): void => {
    const selected = targetInput.value;
    const savedAlt = findSelectedEvent()?.imageAlt ?? "";
    events = readDemoEvents();
    targetInput.replaceChildren(new Option("新しいイベントを追加", ""), ...events.map((event) => new Option(event.title, event.id)));
    targetInput.value = events.some((event) => event.id === selected) ? selected : "";
    const current = findSelectedEvent();
    // 別フォームの保存では一覧と掲載中の写真を更新し、入力途中の内容は残します。
    // 新しい写真を選んでいる間の説明欄は、新しい写真のためのものなので合わせ直しません。
    showCurrentPhoto(current);
    if (!photoInput.files?.[0] && altInput.value === savedAlt) altInput.value = current?.imageAlt ?? "";
  };

  const loadSelectedEvent = (): void => {
    const current = findSelectedEvent();
    titleInput.value = current?.title ?? "";
    monthInput.value = current?.month ?? "";
    descriptionInput.value = current?.description ?? "";
    altInput.value = current?.imageAlt ?? "";
    photoInput.value = "";
    clearPreview();
    showCurrentPhoto(current);
  };

  refreshTargets();
  loadSelectedEvent();
  targetInput.addEventListener("change", () => {
    loadSelectedEvent();
    showResult(result, "");
  });
  photoInput.addEventListener("change", () => {
    // 新しい写真を選んだら、前の写真の説明が残らないよう説明欄を空にします。
    // 選択を取り消したら、選択中のイベントの今の説明に戻します。
    altInput.value = photoInput.files?.[0] ? "" : findSelectedEvent()?.imageAlt ?? "";
    updateAltInput();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    const current = findSelectedEvent();
    const title = titleInput.value.trim();
    const month = monthInput.value;
    const description = descriptionInput.value.trim();
    const imageAlt = altInput.value.trim();
    const file = photoInput.files?.[0];
    if (!title || !description) {
      showResult(result, "見出しと紹介文を入力してください。", true);
      return;
    }
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      showResult(result, "開催年月を「2026-11」のように入力してください。", true);
      return;
    }

    const controls = [targetInput, titleInput, monthInput, descriptionInput, photoInput, altInput, button];
    controls.forEach((control) => { control.disabled = true; });
    try {
      let image = "";
      try {
        if (file) image = await resizePhoto(file);
      } catch {
        showResult(result, "写真を読み込めませんでした。JPEGやPNGの写真をお試しください。", true);
        return;
      }

      const details = { title, month, description };
      if (current) {
        if (file && !isSamePhoto(current, readDemoEvents().find((saved) => saved.id === current.id))) {
          refreshTargets();
          showResult(result, "写真が更新されました。現在の写真を確認してから、もう一度保存してください。", true);
          return;
        }

        let photo: Photo | Pick<Photo, "imageAlt"> | undefined;
        if (file) {
          photo = { image, imageAlt: eventPhotoAlt(imageAlt, title) };
        } else if (current.image) {
          // 写真はそのままで、説明が変わったときだけ説明を保存します。
          const newImageAlt = eventPhotoAlt(imageAlt, title);
          if (newImageAlt !== current.imageAlt) photo = { imageAlt: newImageAlt };
        }
        saveDemoEventEdit(current.id, details, photo);
      } else {
        const newEvent: SchoolEvent = {
          id: globalThis.crypto.randomUUID?.() ?? Date.now() + "-" + Math.random().toString(36).slice(2),
          ...details,
          image,
          imageAlt: image ? eventPhotoAlt(imageAlt, title) : "",
        };
        saveAddedEvents([newEvent, ...readAddedEvents()]);
      }

      refreshTargets();
      loadSelectedEvent();
      onEventSaved();
      showResult(result, "イベントを保存しました。");
    } catch {
      showResult(result, "保存できませんでした。写真のサイズやブラウザーの空き容量をご確認ください。", true);
    } finally {
      controls.forEach((control) => { control.disabled = false; });
      // 全入力欄を戻したあと、写真の有無に合わせて説明欄の入力可否を決め直します。
      updateAltInput();
    }
  });

  return refreshTargets;
}

setupAvailabilityEditor();
const refreshPhotoTargets = setupPhotoEditor(() => refreshEventTargets());
const refreshEventTargets = setupEventEditor(refreshPhotoTargets);
