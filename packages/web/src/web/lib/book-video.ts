/** Record the approved Book assets without changing their design or original media. */
export async function recordBookVideo(options: {
  cover: HTMLCanvasElement;
  photos: HTMLCanvasElement[];
  cta: HTMLCanvasElement;
  videoUrl: string;
  onProgress: (message: string) => void;
}) {
  if (typeof MediaRecorder === "undefined") throw new Error("Este navegador não permite montar o Book em vídeo.");
  const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error("Seu navegador não possui um formato de gravação compatível.");
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.captureStream) throw new Error("Não foi possível preparar o Book em vídeo.");
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playsInline = true;
  const stream = canvas.captureStream(25);
  const audio = new AudioContext();
  let timer: ReturnType<typeof setInterval> | undefined;
  let recorder: MediaRecorder | undefined;
  let source: CanvasImageSource = options.cover;
  let sourceWidth = 1080;
  let sourceHeight = 1080;
  const draw = () => {
    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    ctx.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  };
  const wait = async (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (document.visibilityState === "hidden") throw new Error("Mantenha esta aba aberta durante a montagem do Book. Nenhum vídeo foi enviado.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { clean(); reject(new Error("O vídeo curto demorou demais para carregar.")); }, 30000);
      const clean = () => { clearTimeout(timeout); video.onloadeddata = null; video.onerror = null; };
      video.onloadeddata = () => { clean(); resolve(); };
      video.onerror = () => { clean(); reject(new Error("Não foi possível carregar o vídeo curto para montar o Book.")); };
      video.src = options.videoUrl;
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration + 8 + options.photos.length * 3 > 180) {
      throw new Error("O Book completo precisa ter até 3 minutos. Use um vídeo curto menor.");
    }
    const audioSource = audio.createMediaElementSource(video);
    const destination = audio.createMediaStreamDestination();
    audioSource.connect(destination);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    await audio.resume();
    if (audio.state === "suspended") throw new Error("O navegador bloqueou o áudio. Permita a reprodução de som neste site e tente novamente.");
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    let recordingError: Error | null = null;
    const done = new Promise<Blob>((resolve) => {
      recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => { recordingError = new Error("O navegador interrompeu a gravação do Book."); };
      recorder!.onstop = () => resolve(new Blob(chunks, { type: mime.split(";")[0] }));
    });
    draw();
    timer = setInterval(draw, 40);
    recorder.start(1000);
    options.onProgress("Montando a capa… mantenha esta aba aberta.");
    await wait(3000);
    source = video;
    sourceWidth = video.videoWidth;
    sourceHeight = video.videoHeight;
    options.onProgress("Montando o vídeo curto…");
    await video.play();
    const playbackStarted = performance.now();
    while (!video.ended) {
      if (performance.now() - playbackStarted > (duration + 15) * 1000) throw new Error("A reprodução do vídeo curto foi interrompida. Tente novamente.");
      await wait(100);
    }
    video.pause();
    sourceWidth = sourceHeight = 1080;
    for (const [index, photo] of options.photos.entries()) {
      source = photo;
      options.onProgress(`Montando foto ${index + 1} de ${options.photos.length}…`);
      await wait(3000);
    }
    source = options.cta;
    options.onProgress("Montando contato e CTA final…");
    await wait(5000);
    recorder.stop();
    const blob = await done;
    if (recordingError) throw recordingError;
    if (!blob.size) throw new Error("O Book em vídeo ficou vazio.");
    return blob;
  } finally {
    if (timer) clearInterval(timer);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
    await audio.close();
  }
}
