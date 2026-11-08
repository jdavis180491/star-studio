// Terms & Privacy: shown at sign-up. Keep this in step with how the app really works.
export const PRIVACY_UPDATED = 'November 2026';

export function PrivacyDoc() {
  return (
    <div className="doc">
      <h2>Terms &amp; Privacy</h2>
      <p className="muted small">Last updated {PRIVACY_UPDATED}</p>

      <p>
        Dibbly Dobs is a private learning and creativity app for children aged 4–11. These terms explain how it works and how we keep your children
        safe and private. By creating an account you confirm you are the child’s parent or legal guardian and that you accept these terms.
      </p>

      <h3>1. Grown-ups are in charge</h3>
      <ul>
        <li>Only a parent or guardian can create an account and add children. Children cannot sign themselves up.</li>
        <li>The grown-ups’ area is protected by your password and locks itself again after 30 minutes.</li>
        <li>You decide which friends’ families your child plays with, what Dibbly Dobs are worth, and you can add or remove Dobs at any time.</li>
      </ul>

      <h3>2. What we store</h3>
      <ul>
        <li><b>About you:</b> your email address and your password (stored scrambled, so nobody can read it, including us).</li>
        <li>
          <b>About each child:</b> their first name (only you ever see it), a nickname, their year group, a 4-digit PIN (stored scrambled), their
          avatar, and what they do in the app: videos, stories, letters, reading, spelling and maths results, and their Dibbly Dobs history.
        </li>
        <li>We do not collect surnames, dates of birth, addresses, school names, photos of ID or location.</li>
      </ul>

      <h3>3. Your child’s real name never leaves the grown-ups’ area</h3>
      <p>
        Everywhere else (in the app, with friends and with the AI services below) your child appears only by their nickname. Please choose a nickname
        that isn’t their real name.
      </p>

      <h3>4. AI services we use</h3>
      <p>Some parts of the app use AI to talk, write stories and check spelling. These services only ever receive the nickname, never real names.</p>
      <ul>
        <li>
          <b>Anthropic (Claude):</b> receives the text of what your child says or types (for example, ideas for a story, or a piece of writing to
          spell-check) and writes the replies, stories, daily challenges and video edits.
        </li>
        <li>
          <b>ElevenLabs (the voice):</b> turns the app’s own words into a spoken voice. For this it receives only the app’s text.
        </li>
        <li>
          <b>ElevenLabs (listening):</b> when your child reads aloud or talks to Story Buddy or the Director, their voice is streamed to
          ElevenLabs’ speech-to-text service, which turns it into words so the app can follow along. The sound is sent only while the
          microphone is on, is used only to make the text, and isn’t linked to your child’s name. If ElevenLabs isn’t available, the
          iPad’s built-in speech recognition (Apple) is used instead.
        </li>
        <li>
          <b>OpenAI (optional):</b> if switched on, the sound from a finished Star Studio video is sent to turn speech into captions. It is off unless
          set up.
        </li>
        <li>Camera effects such as backgrounds work on the iPad itself; the live camera picture is not sent anywhere.</li>
      </ul>
      <p>By accepting, you agree to your child’s voice and video being processed in these ways so the app can work.</p>

      <h3>5. Videos stay private</h3>
      <ul>
        <li>Videos are kept in private storage. There are no public links, no search and no way for strangers to find them.</li>
        <li>Each video can be watched only by your own family and, after the daily premiere, by the children in your child’s crew.</li>
        <li>Video links are made fresh each time and stop working after a short time, so a copied link can’t be shared.</li>
        <li>You can approve, reject or delete any of your child’s videos.</li>
      </ul>

      <h3>6. Friends and crews are invite-only</h3>
      <ul>
        <li>A crew is 2–4 families who join with a private invite code that a grown-up shares. There is no way to find or add strangers.</li>
        <li>
          Children can’t send free-text messages to each other. They react to videos with a fixed set of stickers and awards.
        </li>
        <li>
          The only written messages are stories in the Writing section. Any story going to a child in another family is checked and approved by the
          sender’s grown-up before it is delivered.
        </li>
      </ul>

      <h3>7. Keeping accounts safe</h3>
      <ul>
        <li>Passwords and PINs are stored scrambled. After 5 wrong PIN tries, a child’s login is paused for a while.</li>
        <li>Each device stays linked for up to 180 days. Logging out unlinks it.</li>
        <li>All connections to the app are encrypted (HTTPS).</li>
      </ul>

      <h3>8. No adverts, no selling, no tracking</h3>
      <p>
        There are no adverts, no in-app purchases with real money, and no tracking or analytics tools. We never sell or share your family’s data.
        Fonts and the camera-effects model are downloaded from Google and jsDelivr, which (like any website) see your device’s network address but
        nothing about your child.
      </p>

      <h3>9. Phone notifications (optional)</h3>
      <p>
        If you turn on phone notifications, short messages such as “Ann earned a Dibbly Dob” or “A video is ready to approve” are sent to your phone
        through Apple’s or Google’s notification service. They are encrypted, so that service can’t read them. You can turn them off at any time.
      </p>

      <h3>10. Deleting your data</h3>
      <ul>
        <li>You can delete any video, any child’s profile or your whole account from the grown-ups’ area at any time.</li>
        <li>Deleting a child removes all their videos, stories, results and Dobs. Deleting your account removes everything belonging to your family.</li>
      </ul>

      <h3>11. Changes and questions</h3>
      <p>
        If these terms change in a way that matters, we’ll ask you to read and accept them again. If you have a question about your family’s data,
        contact the person who invited you to Dibbly Dobs.
      </p>
    </div>
  );
}

// Full-screen reader with an Accept button at the bottom.
export function PrivacySheet({ onAccept, onClose }) {
  return (
    <div className="doc-overlay" role="dialog" aria-modal="true" aria-label="Terms and Privacy">
      <div className="doc-panel">
        <button type="button" className="doc-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <PrivacyDoc />
        <div className="doc-actions">
          <button type="button" className="big-btn primary" onClick={onAccept}>
            Accept
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
