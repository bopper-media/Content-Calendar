/** Standalone export: uploads stay in the browser. The file is read into a
 *  data URL, which the views store and render exactly like a hosted URL. */
export const DIRECT_UPLOAD_FROM_BYTES = 4_000_000;

export async function uploadContentFile(file: File | Blob, fallback = "Couldn't upload that file. Try again."): Promise<string> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(fallback));
      reader.readAsDataURL(file);
    });
  } catch {
    throw new Error(fallback);
  }
}
