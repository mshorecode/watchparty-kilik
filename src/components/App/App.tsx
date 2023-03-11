import './App.css';

import * as MediasoupClient from 'mediasoup-client';
import axios from 'axios';
import React from 'react';
import {
  Button,
  Dimmer,
  Dropdown,
  DropdownProps,
  Grid,
  Icon,
  Input,
  Loader,
  Message,
  Popup,
  Menu,
  Modal,
  Label,
  SemanticCOLORS,
  Form,
} from 'semantic-ui-react';
import io, { Socket } from 'socket.io-client';
import { default as toWebVTT } from 'srt-webvtt';
import {
  formatSpeed,
  getMediaType,
  iceServers,
  isMobile,
  serverPath,
  testAutoplay,
  openFileSelector,
  getAndSaveClientId,
  calculateMedian,
  getUserImage,
  getColorForString,
} from '../../utils';
import { generateName } from '../../utils/generateName';
import { Chat } from '../Chat';
import { TopBar } from '../TopBar';
import { VBrowser } from '../VBrowser';
import { VideoChat } from '../VideoChat';
import { getCurrentSettings } from '../Settings';
import { MultiStreamModal } from '../Modal/MultiStreamModal';
import { ComboBox } from '../ComboBox/ComboBox';
import { SearchComponent } from '../SearchComponent/SearchComponent';
import { Controls } from '../Controls/Controls';
import { VBrowserModal } from '../Modal/VBrowserModal';
import { SettingsTab } from '../Settings/SettingsTab';
import { ErrorModal } from '../Modal/ErrorModal';
import { PasswordModal } from '../Modal/PasswordModal';
import { ScreenShareModal } from '../Modal/ScreenShareModal';
import { FileShareModal } from '../Modal/FileShareModal';
import firebase from 'firebase/compat/app';
import { SubtitleModal } from '../Modal/SubtitleModal';
import { HTML } from './HTML';
import { YouTube } from './YouTube';

declare global {
  interface Window {
    onYouTubeIframeAPIReady: any;
    YT: any;
    FB: any;
    Hls: any;
    WebTorrent: any;
    watchparty: {
      ourStream: MediaStream | undefined;
      videoRefs: HTMLVideoElementDict;
      videoPCs: PCDict;
      webtorrent: any;
    };
  }
}

window.watchparty = {
  ourStream: undefined,
  videoRefs: {},
  videoPCs: {},
  webtorrent: null,
};

interface AppProps {
  vanity?: string;
  urlRoomId?: string;
  user?: firebase.User;
  isSubscriber: boolean;
  isCustomer: boolean;
  beta: boolean;
  streamPath: string | undefined;
}

interface AppState {
  state: 'init' | 'starting' | 'connected';
  currentMedia: string;
  currentSubtitle: string;
  currentMediaPaused: boolean;
  participants: User[];
  rosterUpdateTS: Number;
  chat: ChatMessage[];
  playlist: PlaylistVideo[];
  tsMap: NumberDict;
  nameMap: StringDict;
  pictureMap: StringDict;
  myName: string;
  myPicture: string;
  loading: boolean;
  scrollTimestamp: number;
  unreadCount: number;
  fullScreen: boolean;
  controlsTimestamp: number;
  watchOptions: SearchResult[];
  isVBrowser: boolean;
  isAutoPlayable: boolean;
  downloaded: number;
  total: number;
  speed: number;
  connections: number;
  multiStreamSelection?: {
    name: string;
    url: string;
    length: number;
    playFn?: () => void;
  }[];
  overlayMsg: string;
  isErrorAuth: boolean;
  settings: Settings;
  vBrowserResolution: string;
  isVBrowserLarge: boolean;
  nonPlayableMedia: boolean;
  currentTab: string;
  isSubscribeModalOpen: boolean;
  isVBrowserModalOpen: boolean;
  isScreenShareModalOpen: boolean;
  isFileShareModalOpen: boolean;
  isSubtitleModalOpen: boolean;
  roomLock: string;
  controller?: string;
  savedPasswords: StringDict;
  roomId: string;
  errorMessage: string;
  successMessage: string;
  warningMessage: string;
  isChatDisabled: boolean;
  showRightBar: boolean;
  owner: string | undefined;
  vanity: string | undefined;
  password: string | undefined;
  roomLink: string;
  roomTitle: string | undefined;
  roomDescription: string | undefined;
  roomTitleColor: string | undefined;
  mediaPath: string | undefined;
  roomPlaybackRate: number;
}

export default class App extends React.Component<AppProps, AppState> {
  state: AppState = {
    state: 'starting',
    currentMedia: '',
    currentMediaPaused: false,
    currentSubtitle: '',
    participants: [],
    rosterUpdateTS: Number(new Date()),
    chat: [],
    playlist: [],
    tsMap: {},
    nameMap: {},
    pictureMap: {},
    myName: '',
    myPicture: '',
    loading: true,
    scrollTimestamp: 0,
    unreadCount: 0,
    fullScreen: false,
    controlsTimestamp: 0,
    watchOptions: [],
    isVBrowser: false,
    isAutoPlayable: true,
    downloaded: 0,
    total: 0,
    speed: 0,
    connections: 0,
    multiStreamSelection: undefined,
    overlayMsg: '',
    isErrorAuth: false,
    settings: {},
    vBrowserResolution: '1280x720@30',
    isVBrowserLarge: false,
    nonPlayableMedia: false,
    currentTab:
      new URLSearchParams(window.location.search).get('tab') ?? 'chat',
    isSubscribeModalOpen: false,
    isVBrowserModalOpen: false,
    isScreenShareModalOpen: false,
    isFileShareModalOpen: false,
    isSubtitleModalOpen: false,
    roomLock: '',
    controller: '',
    roomId: '',
    savedPasswords: {},
    errorMessage: '',
    successMessage: '',
    warningMessage: '',
    isChatDisabled: false,
    showRightBar: true,
    owner: undefined,
    vanity: undefined,
    password: undefined,
    roomLink: '',
    roomTitle: '',
    roomDescription: '',
    roomTitleColor: '',
    mediaPath: undefined,
    roomPlaybackRate: 0,
  };
  socket: Socket = null as any;
  ytDebounce = true;
  localStreamToPublish?: MediaStream;
  isLocalStreamAFile = false;
  publisherConns: PCDict = {};
  consumerConn?: RTCPeerConnection;
  progressUpdater?: number;
  heartbeat: number | undefined = undefined;

  launchMultiSelect = (
    data?: { name: string; url: string; length: number; playFn?: () => void }[]
  ) => {
    this.setState({ multiStreamSelection: data });
  };

  resetMultiSelect = () => {
    this.setState({ multiStreamSelection: undefined });
  };

  YouTubeInterface: YouTube = new YouTube(null);
  HTMLInterface: HTML = new HTML('leftVideo', this.launchMultiSelect);
  Player = () => {
    if (this.isYouTube()) {
      return this.YouTubeInterface;
    } else {
      return this.HTMLInterface;
    }
  };

  chatRef = React.createRef<Chat>();

  async componentDidMount() {
    document.onfullscreenchange = this.onFullScreenChange;
    document.onkeydown = this.onKeydown;

    // Send heartbeat to the server
    this.heartbeat = window.setInterval(() => {
      window.fetch(serverPath + '/ping');
    }, 10 * 60 * 1000);

    // window.Hls = (await import('hls.js')).default;
    // window.WebTorrent = //@ts-ignore
    // (await import('webtorrent/dist/webtorrent.min.js')).default;
    // client = new window.WebTorrent();

    const canAutoplay = await testAutoplay();
    this.setState({ isAutoPlayable: canAutoplay });
    this.loadSettings();
    this.loadYouTube();
    this.init();
  }

  componentWillUnmount() {
    document.removeEventListener('fullscreenchange', this.onFullScreenChange);
    document.removeEventListener('keydown', this.onKeydown);
    window.clearInterval(this.heartbeat);
  }

  componentDidUpdate(prevProps: AppProps) {
    if (this.props.user && !prevProps.user) {
      this.loadSignInData();
    }
  }

  loadSettings = async () => {
    // Load settings from localstorage
    let settings = getCurrentSettings();
    this.setState({ settings });
  };

  loadSignInData = async () => {
    const user = this.props.user;
    if (user && this.socket) {
      // NOTE: firebase auth doesn't provide the actual first name data that individual providers (G/FB) do
      // It's accessible at the time the user logs in but not afterward
      // If we want accurate surname/given name we'll need to save that somewhere
      const firstName = user.displayName?.split(' ')[0];
      if (firstName) {
        this.updateName(null, { value: firstName });
      }
      const userImage = await getUserImage(user);
      if (userImage) {
        this.updatePicture(userImage);
      }
      this.updateUid(user);
    }
  };

  loadYouTube = () => {
    // This code loads the IFrame Player API code asynchronously.
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.body.append(tag);
    window.onYouTubeIframeAPIReady = () => {
      // Note: this fails silently if the element is not available
      const ytPlayer = new window.YT.Player('leftYt', {
        events: {
          onReady: () => {
            console.log('yt onReady');
            this.YouTubeInterface = new YouTube(ytPlayer);
            this.setState({ loading: false });
            // We might have failed to play YT originally, ask for the current video again
            if (this.isYouTube()) {
              console.log('requesting host data again after ytReady');
              this.socket.emit('CMD:askHost');
            }
          },
          onStateChange: (e: any) => {
            if (this.isYouTube() && e.data === window.YT?.PlayerState?.CUED) {
              this.setState({ loading: false });
            }
            if (this.isYouTube() && e.data === window.YT?.PlayerState?.ENDED) {
              this.onVideoEnded();
            }
            if (
              this.ytDebounce &&
              ((e.data === window.YT?.PlayerState?.PLAYING &&
                this.state.currentMediaPaused) ||
                (e.data === window.YT?.PlayerState?.PAUSED &&
                  !this.state.currentMediaPaused))
            ) {
              this.ytDebounce = false;
              if (e.data === window.YT?.PlayerState?.PLAYING) {
                this.socket.emit('CMD:play');
                this.doPlay();
              } else {
                this.socket.emit('CMD:pause');
                this.doPause();
              }
              window.setTimeout(() => (this.ytDebounce = true), 500);
            }
          },
        },
      });
    };
  };

  // Functions for managing room settings
  getRoomLink = (vanity: string) => {
    if (vanity) {
      return `${window.location.origin}/r/${vanity}`;
    }
    return `${window.location.origin}/watch${this.state.roomId}`;
  };

  handleRoomState = (data: any) => {
    this.setOwner(data.owner);
    this.setVanity(data.vanity);
    this.setPassword(data.password);
    this.setRoomLink(this.getRoomLink(data.vanity));
    this.setIsChatDisabled(data.isChatDisabled);
    this.setRoomTitle(data.roomTitle);
    this.setRoomDescription(data.roomDescription);
    this.setRoomTitleColor(data.roomTitleColor);
    this.setMediaPath(data.mediaPath);
    window.history.replaceState('', '', this.getRoomLink(data.vanity));
  };

  setOwner = (owner: string) => {
    this.setState({ owner });
  };
  setVanity = (vanity: string | undefined) => {
    this.setState({ vanity });
  };
  setPassword = (password: string | undefined) => {
    this.setState({ password });
  };
  setRoomLink = (roomLink: string) => {
    this.setState({ roomLink });
  };
  setRoomTitle = (roomTitle: string | undefined) => {
    this.setState({ roomTitle });
  };
  setRoomDescription = (roomDescription: string | undefined) => {
    this.setState({ roomDescription });
  };
  setRoomTitleColor = (roomTitleColor: string | undefined) => {
    this.setState({ roomTitleColor });
  };
  setMediaPath = (mediaPath: string | undefined) => {
    this.setState({ mediaPath });
  };

  setRoomLock = async (locked: boolean) => {
    const uid = this.props.user?.uid;
    const token = await this.props.user?.getIdToken();
    this.socket.emit('CMD:lock', { uid, token, locked });
  };

  haveLock = () => {
    if (!this.state.roomLock) {
      return true;
    }
    return this.props.user?.uid === this.state.roomLock;
  };

  setIsChatDisabled = (val: boolean) => this.setState({ isChatDisabled: val });

  clearChat = async () => {
    const uid = this.props.user?.uid;
    const token = await this.props.user?.getIdToken();
    this.socket.emit('CMD:deleteChatMessages', { uid, token });
  };

  init = async () => {
    let roomId = '/' + this.props.urlRoomId;
    // if a vanity name, resolve the url to a room id
    if (this.props.vanity) {
      try {
        const response = await axios.get(
          serverPath + '/resolveRoom/' + this.props.vanity
        );
        if (response.data.roomId) {
          roomId = response.data.roomId;
        } else {
          this.setState({ overlayMsg: "Couldn't load this room." });
        }
      } catch (e) {
        console.error(e);
        this.setState({ overlayMsg: "Couldn't load this room." });
        return;
      }
    }
    this.setState({ roomId }, () => {
      this.join(roomId);
    });
  };

  join = async (roomId: string) => {
    let password = '';
    try {
      const savedPasswordsString = window.localStorage.getItem(
        'watchparty-passwords'
      );
      const savedPasswords = JSON.parse(savedPasswordsString || '{}');
      this.setState({ savedPasswords });
      password = savedPasswords[roomId] || '';
    } catch (e) {
      console.warn('[ALERT] Could not parse saved passwords');
    }
    const response = await axios.get(serverPath + '/resolveShard' + roomId);
    const shard = Number(response.data) ?? '';
    const socket = io(serverPath + roomId, {
      transports: ['websocket'],
      query: {
        clientId: getAndSaveClientId(),
        password,
        shard,
      },
    });
    this.socket = socket;
    socket.on('connect', async () => {
      this.setState({
        state: 'connected',
        overlayMsg: '',
        errorMessage: '',
        successMessage: '',
        warningMessage: '',
      });
      // Load username from localstorage
      let userName = window.localStorage.getItem('watchparty-username');
      this.updateName(null, { value: userName || (await generateName()) });
      this.loadSignInData();
    });
    socket.on('connect_error', (err: any) => {
      console.error(err);
      if (err.message === 'Invalid namespace') {
        this.setState({ overlayMsg: "Couldn't load this room." });
      } else if (err.message === 'not authorized') {
        this.setState({ isErrorAuth: true });
      } else if (err.message === 'room full') {
        this.setState({ overlayMsg: 'This room is full.' });
      }
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // the disconnection was initiated by the server, you need to reconnect manually
        this.setState({ overlayMsg: 'Disconnected from server.' });
      } else {
        // else the socket will automatically try to reconnect
        // Use the alert pill since it's less disruptive
        this.setState({ warningMessage: 'Reconnecting...' });
      }
    });
    socket.on('errorMessage', (err: string) => {
      this.setState({ errorMessage: err });
      setTimeout(() => {
        this.setState({ errorMessage: '' });
      }, 3000);
    });
    socket.on('successMessage', (success: string) => {
      this.setState({ successMessage: success });
      setTimeout(() => {
        this.setState({ successMessage: '' });
      }, 3000);
    });
    socket.on('kicked', () => {
      window.location.assign('/');
    });
    socket.on('REC:play', () => {
      this.doPlay();
    });
    socket.on('REC:pause', () => {
      this.doPause();
    });
    socket.on('REC:seek', (data: any) => {
      this.Player().seekVideo(data);
    });
    socket.on('REC:playbackRate', (data: number) => {
      this.setState({ roomPlaybackRate: data });
      if (data > 0) {
        this.Player().setPlaybackRate(data);
      }
    });
    // socket.on('REC:autoPlaybackRate', (data: number) => {
    //   this.Player().setPlaybackRate(data);
    // });
    socket.on('REC:subtitle', (data: string) => {
      this.setState({ currentSubtitle: data }, () => {
        this.loadSubtitles();
      });
    });
    socket.on('REC:changeController', (data: string) => {
      this.setState({ controller: data });
    });
    socket.on('REC:host', async (data: HostState) => {
      let currentMedia = data.video || '';
      if (this.isScreenShare() && !currentMedia.startsWith('screenshare://')) {
        this.stopPublishingLocalStream();
      }
      if (this.isFileShare() && !currentMedia.startsWith('fileshare://')) {
        this.stopPublishingLocalStream();
      }
      if (this.isScreenShare() && currentMedia.startsWith('screenshare://')) {
        // Ignore, it's probably a reconnection
        return;
      }
      if (this.isFileShare() && currentMedia.startsWith('fileshare://')) {
        // Ignore, it's probably a reconnection
        return;
      }
      if (this.isVBrowser() && !currentMedia.startsWith('vbrowser://')) {
        this.stopVBrowser();
      }
      this.setState(
        {
          currentMedia,
          currentMediaPaused: data.paused,
          currentSubtitle: data.subtitle,
          loading: Boolean(data.video),
          nonPlayableMedia: false,
          isVBrowserLarge: data.isVBrowserLarge,
          vBrowserResolution: data.isVBrowserLarge
            ? '1920x1080@30'
            : '1280x720@30',
          controller: data.controller,
        },
        async () => {
          // Stop all players
          // Unless the user is sharing a file otherwise it interferes
          if (!this.isLocalStreamAFile) {
            this.HTMLInterface.pauseVideo();
          }
          this.YouTubeInterface.stopVideo();

          if (this.isScreenShare() || this.isFileShare() || this.isVBrowser()) {
            console.log(
              'skipping REC:host video update since we are using webRTC (fileshare, screenshare, or vbrowser). Check setupRTCConnections()'
            );
            if (!(this.isVBrowser() && !this.getVBrowserHost())) {
              // Remove the loader unless we're waiting for a vbrowser
              this.setLoadingFalse();
            }
            return;
          }
          if (this.isYouTube() && !this.YouTubeInterface.isReady()) {
            console.log(
              'YT player not ready, onReady callback will retry when it is'
            );
            return;
          }
          // Start this video
          await this.doSrc(data.video, data.videoTS);
          if (!data.paused) {
            this.doPlay();
          }
          if (data.subtitle) {
            this.loadSubtitles();
          }
          if (data.playbackRate) {
            this.setState({ roomPlaybackRate: data.playbackRate });
            this.Player().setPlaybackRate(data.playbackRate);
          }
          // One time, when we're ready to play
          const leftVideo = document.getElementById('leftVideo');
          leftVideo?.addEventListener(
            'canplay',
            () => {
              this.setLoadingFalse();
              this.jumpToLeader();
            },
            { once: true }
          );

          // Progress updater
          window.clearInterval(this.progressUpdater);
          this.setState({ downloaded: 0, total: 0, speed: 0 });
          if (currentMedia.includes('/stream?torrent=magnet')) {
            this.progressUpdater = window.setInterval(async () => {
              const response = await window.fetch(
                currentMedia.replace('/stream', '/progress')
              );
              const data = await response.json();
              this.setState({
                downloaded: data.downloaded,
                total: data.total,
                speed: data.speed,
                connections: data.connections,
              });
            }, 1000);
          }
          if (currentMedia.startsWith('magnet:')) {
            this.progressUpdater = window.setInterval(async () => {
              const client = window.watchparty.webtorrent;
              this.setState({
                downloaded: client?.torrents[0]?.downloaded,
                total: client?.torrents[0]?.length,
                speed: client?.torrents[0]?.downloadSpeed,
                connections: client?.torrents[0]?.numPeers,
              });
            }, 1000);
          }
        }
      );
    });
    socket.on('REC:chat', (data: ChatMessage) => {
      if (
        !getCurrentSettings().disableChatSound &&
        ((document.visibilityState && document.visibilityState !== 'visible') ||
          this.state.currentTab !== 'chat')
      ) {
        new Audio('/clearly.mp3').play();
      }
      this.state.chat.push(data);
      this.setState({
        chat: this.state.chat,
        scrollTimestamp: Number(new Date()),
        unreadCount:
          this.state.currentTab === 'chat'
            ? this.state.unreadCount
            : this.state.unreadCount + 1,
      });
    });
    socket.on('REC:addReaction', (data: Reaction) => {
      const { chat } = this.state;
      const msgIndex = chat.findIndex(
        (m) => m.id === data.msgId && m.timestamp === data.msgTimestamp
      );
      if (msgIndex === -1) {
        return;
      }
      const msg = chat[msgIndex];
      msg.reactions = msg.reactions || {};
      msg.reactions[data.value] = msg.reactions[data.value] || [];
      msg.reactions[data.value].push(data.user);
      this.setState({ chat }, () => {
        // if we add a reaction to the last message we need to scroll down
        // or else the reaction icon might be hidden
        if (
          msgIndex === chat.length - 1 &&
          this.chatRef.current?.state.isNearBottom
        ) {
          this.chatRef.current?.scrollToBottom();
        }
      });
    });
    socket.on('REC:removeReaction', (data: Reaction) => {
      const { chat } = this.state;
      const msg = chat.find(
        (m) => m.id === data.msgId && m.timestamp === data.msgTimestamp
      );
      if (!msg || !msg.reactions?.[data.value]) {
        return;
      }
      msg.reactions[data.value] = msg.reactions[data.value].filter(
        (id) => id !== data.user
      );
      this.setState({ chat });
    });
    socket.on('REC:tsMap', (data: NumberDict) => {
      this.setState({ tsMap: data }, () => {
        if (
          !this.state.currentMediaPaused &&
          !this.state.currentMedia.includes('.m3u8') &&
          this.state.roomPlaybackRate === 0
        ) {
          const leader = this.getLeaderTime();
          const delta = leader - data[this.socket.id];
          // Set leader pbr to 1
          let pbr = 1;
          // Add .01 pbr for each 100ms delay
          if (delta > 0.5) {
            pbr += Number((delta / 10).toFixed(2));
            pbr = Math.min(pbr, 1.2);
          }
          // console.log(delta, pbr);
          if (this.Player().getPlaybackRate() !== pbr) {
            this.Player().setPlaybackRate(pbr);
          }
        }
        this.syncSubtitle();
      });
    });
    socket.on('REC:nameMap', (data: StringDict) => {
      this.setState({ nameMap: data });
    });
    socket.on('REC:pictureMap', (data: StringDict) => {
      this.setState({ pictureMap: data });
    });
    socket.on('REC:lock', (data: string) => {
      this.setState({ roomLock: data });
    });
    socket.on('roster', (data: User[]) => {
      this.setState(
        { participants: data, rosterUpdateTS: Number(new Date()) },
        () => {
          this.setupRTCConnections();
        }
      );
    });
    socket.on('chatinit', (data: ChatMessage[]) => {
      this.setState({ chat: data, scrollTimestamp: Number(new Date()) });
    });
    socket.on('playlist', (data: PlaylistVideo[]) => {
      this.setState({ playlist: data });
    });
    socket.on('signalSS', async (data: any) => {
      process.env.NODE_ENV === 'development' && console.log(data);
      // Handle messages received from signaling server
      const msg = data.msg;
      const from = data.from;
      // Determine whether the message came from the sharer or the sharee
      const pc = (
        data.sharer ? this.consumerConn : this.publisherConns[from]
      ) as RTCPeerConnection;
      if (msg.ice !== undefined) {
        pc.addIceCandidate(new RTCIceCandidate(msg.ice));
      } else if (msg.sdp && msg.sdp.type === 'offer') {
        // console.log('offer');
        // TODO Currently ios/Safari cannot handle this property, so remove it from the offer
        const _sdp = msg.sdp.sdp
          .split('\n')
          .filter((line: string) => {
            return line.trim() !== 'a=extmap-allow-mixed';
          })
          .join('\n');
        msg.sdp.sdp = _sdp;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        // Allow stereo audio
        answer.sdp = answer.sdp?.replace(
          'useinbandfec=1',
          'useinbandfec=1; stereo=1; maxaveragebitrate=510000'
        );
        // console.log(answer.sdp);
        // Allow multichannel audio if Chromium
        const isChromium = Boolean((window as any).chrome);
        if (isChromium) {
          answer.sdp = answer.sdp
            ?.replace('opus/48000/2', 'multiopus/48000/6')
            .replace(
              'useinbandfec=1',
              'channel_mapping=0,4,1,2,3,5; num_streams=4; coupled_streams=2;maxaveragebitrate=510000;minptime=10;useinbandfec=1'
            );
        }
        await pc.setLocalDescription(answer);
        this.sendSignalSS(from, { sdp: pc.localDescription }, !data.sharer);
      } else if (msg.sdp && msg.sdp.type === 'answer') {
        pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      }
    });
    socket.on('REC:getRoomState', this.handleRoomState);
    window.setInterval(() => {
      if (this.state.currentMedia) {
        this.socket.emit('CMD:ts', this.Player().getCurrentTime());
      }
    }, 1000);
  };

  startFileShare = async (useMediaSoup: boolean) => {
    const files = await openFileSelector();
    if (!files) {
      return;
    }
    const file = files[0];
    const leftVideo = document.getElementById('leftVideo') as HTMLMediaElement;
    leftVideo.srcObject = null;
    leftVideo.src = URL.createObjectURL(file);
    leftVideo.play();
    //@ts-ignore
    this.localStreamToPublish = leftVideo?.captureStream();
    this.isLocalStreamAFile = true;
    if (this.localStreamToPublish) {
      if (useMediaSoup) {
        this.startMediasoup(true);
      } else {
        const stream = this.localStreamToPublish;
        // Can render video to a canvas to resize it, reduce size
        let hasStartedFileShare = false;
        stream.onaddtrack = () => {
          console.log(stream, stream.getVideoTracks(), stream.getAudioTracks());
          if (
            !hasStartedFileShare &&
            stream.getVideoTracks().length &&
            stream.getAudioTracks().length
          ) {
            hasStartedFileShare = true;
            stream.getVideoTracks()[0].onended = this.stopPublishingLocalStream;
            this.socket.emit('CMD:joinScreenShare', { file: true });
          }
        };
      }
    }
  };

  startScreenShare = async (useMediaSoup: boolean) => {
    if (navigator.mediaDevices.getDisplayMedia) {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        //@ts-ignore
        video: { height: 720, logicalSurface: true },
        audio: {
          autoGainControl: false,
          channelCount: 2,
          echoCancellation: false,
          latency: 0,
          noiseSuppression: false,
          sampleRate: 48000,
          sampleSize: 16,
        },
      });
      stream.getVideoTracks()[0].onended = this.stopPublishingLocalStream;
      this.localStreamToPublish = stream;
      if (useMediaSoup) {
        this.startMediasoup(false);
      } else {
        this.socket.emit('CMD:joinScreenShare');
      }
    }
  };

  // Share the video to mediasoup
  startMediasoup = async (isFile: boolean) => {
    const localStream = this.localStreamToPublish;
    let clientId = null;
    let device: MediasoupClient.types.Device | null = null;
    let producerTransport: any = null;
    let videoProducer: any = null;
    let audioProducer: any = null;
    let socket: Socket | null = null;

    // =========== socket.io ==========
    const connectSocket = (mediasoupURL: string) => {
      if (socket) {
        socket.close();
        socket = null;
        clientId = null;
      }

      return new Promise<void>((resolve, reject) => {
        socket = io(mediasoupURL, {
          transports: ['websocket'],
        });

        socket?.on('connect', function () {
          console.log('socket.io connected()');
        });
        socket?.on('error', function (err) {
          console.error('socket.io ERROR:', err);
          reject(err);
        });
        socket?.on('disconnect', function (evt) {
          console.log('socket.io disconnect:', evt);
        });
        socket?.on('message', function (message) {
          console.log('socket.io message:', message);
          if (message.type === 'welcome') {
            if (socket?.id !== message.id) {
              console.warn(
                'WARN: something wrong with clientID',
                socket?.id,
                message.id
              );
            }

            clientId = message.id;
            console.log('connected to server. clientId=' + clientId);
            resolve();
          } else {
            console.error('UNKNOWN message from server:', message);
          }
        });
        socket?.on('newProducer', async function (message) {
          console.warn('IGNORE socket.io newProducer:', message);
        });
      });
    };

    function sendRequest(type: any, data: any) {
      return new Promise<any>((resolve, reject) => {
        socket?.emit(type, data, (err: any, response: any) => {
          if (!err) {
            // Success response, so pass the mediasoup response to the local Room.
            resolve(response);
          } else {
            reject(err);
          }
        });
      });
    }

    async function publish() {
      // --- get transport info ---
      console.log('--- createProducerTransport --');
      const params = await sendRequest('createProducerTransport', {});
      console.log('transport params:', params);
      producerTransport = device?.createSendTransport(params);
      console.log('createSendTransport:', producerTransport);

      // --- join & start publish --
      producerTransport.on(
        'connect',
        async ({ dtlsParameters }: any, callback: any, errback: any) => {
          console.log('--trasnport connect');
          sendRequest('connectProducerTransport', {
            dtlsParameters: dtlsParameters,
          })
            .then(callback)
            .catch(errback);
        }
      );

      producerTransport.on(
        'produce',
        async ({ kind, rtpParameters }: any, callback: any, errback: any) => {
          console.log('--trasnport produce');
          try {
            const { id } = await sendRequest('produce', {
              transportId: producerTransport.id,
              kind,
              rtpParameters,
            });
            callback({ id });
          } catch (err) {
            errback(err);
          }
        }
      );

      producerTransport.on('connectionstatechange', (state: any) => {
        switch (state) {
          case 'connecting':
            console.log('publishing...');
            break;

          case 'connected':
            console.log('published');
            break;

          case 'failed':
            console.log('failed');
            producerTransport.close();
            break;

          default:
            break;
        }
      });

      const videoTrack = localStream?.getVideoTracks()[0];
      if (videoTrack) {
        const trackParams = { track: videoTrack };
        videoProducer = await producerTransport.produce(trackParams);
        console.log(videoProducer);
      }
      const audioTrack = localStream?.getAudioTracks()[0];
      if (audioTrack) {
        const trackParams = { track: audioTrack };
        audioProducer = await producerTransport.produce(trackParams);
        console.log(audioProducer);
      }
    }

    async function loadDevice(routerRtpCapabilities: any) {
      device = new MediasoupClient.Device();
      await device.load({ routerRtpCapabilities });
    }

    const resp = await axios.get(serverPath + '/requestMediasoup');
    await connectSocket(resp.data);
    // --- get capabilities --
    const data = await sendRequest('getRouterRtpCapabilities', {});
    console.log('getRouterRtpCapabilities:', data);
    await loadDevice(data);
    // joinScreenShare to set room video value
    this.socket.emit('CMD:joinScreenShare', {
      file: isFile,
      mediasoup: resp.data,
    });
    await publish();
  };

  // Play the video from MediaSoup
  consumeMediasoup = async (mediaSoupURL: string) => {
    let clientId: any = null;
    let device: any = null;
    let consumerTransport: any = null;
    let videoConsumer: any = null;
    let audioConsumer: any = null;
    let socket: Socket | null = null;

    // =========== socket.io ==========
    const connectSocket = () => {
      if (socket) {
        socket.close();
        socket = null;
        clientId = null;
      }

      return new Promise<void>((resolve, reject) => {
        socket = io(mediaSoupURL, {
          transports: ['websocket'],
        });

        socket?.on('connect', function () {
          console.log('socket.io connected()');
        });
        socket?.on('error', function (err) {
          console.error('socket.io ERROR:', err);
          reject(err);
        });
        socket?.on('disconnect', function (evt) {
          console.log('socket.io disconnect:', evt);
        });
        socket?.on('message', function (message) {
          console.log('socket.io message:', message);
          if (message.type === 'welcome') {
            if (socket?.id !== message.id) {
              console.warn(
                'WARN: something wrong with clientID',
                socket?.id,
                message.id
              );
            }

            clientId = message.id;
            console.log('connected to server. clientId=' + clientId);
            resolve();
          } else {
            console.error('UNKNOWN message from server:', message);
          }
        });
        socket?.on('newProducer', async function (message) {
          console.log('socket.io newProducer:', message);
          if (consumerTransport) {
            // start consume
            if (message.kind === 'video') {
              videoConsumer = await consumeAndResume(
                consumerTransport,
                message.kind
              );
            } else if (message.kind === 'audio') {
              audioConsumer = await consumeAndResume(
                consumerTransport,
                message.kind
              );
            }
          }
        });

        socket?.on('producerClosed', function (message) {
          console.log('socket.io producerClosed:', message);
          const localId = message.localId;
          const remoteId = message.remoteId;
          const kind = message.kind;
          console.log(
            '--try removeConsumer remoteId=' +
              remoteId +
              ', localId=' +
              localId +
              ', kind=' +
              kind
          );
          if (kind === 'video') {
            if (videoConsumer) {
              videoConsumer.close();
              videoConsumer = null;
            }
          } else if (kind === 'audio') {
            if (audioConsumer) {
              audioConsumer.close();
              audioConsumer = null;
            }
          }
        });
      });
    };

    function sendRequest(type: any, data: any) {
      return new Promise<any>((resolve, reject) => {
        socket?.emit(type, data, (err: any, response: any) => {
          if (!err) {
            // Success response, so pass the mediasoup response to the local Room.
            resolve(response);
          } else {
            reject(err);
          }
        });
      });
    }

    // =========== media handling ==========
    const addRemoteTrack = (id: string, track: MediaStreamTrack) => {
      let video = document.getElementById('leftVideo') as HTMLMediaElement;
      console.log(track);
      if (video.srcObject) {
        // Track already exists, add it
        (video.srcObject as MediaStream).addTrack(track);
      } else {
        const mediaStream = new MediaStream();
        mediaStream.addTrack(track);
        video.srcObject = mediaStream;
      }
      this.doPlay();
    };

    async function consumeAndResume(transport: any, kind: any) {
      const consumer = await consume(consumerTransport, kind);
      if (consumer) {
        console.log('-- track exist, consumer ready. kind=' + kind);
        if (kind === 'video') {
          console.log('-- resume kind=' + kind);
          sendRequest('resume', { kind: kind })
            .then(() => {
              console.log('resume OK');
              return consumer;
            })
            .catch((err) => {
              console.error('resume ERROR:', err);
              return consumer;
            });
        } else {
          console.log('-- do not resume kind=' + kind);
        }
      } else {
        console.log('-- no consumer yet. kind=' + kind);
        return null;
      }
    }

    async function loadDevice(routerRtpCapabilities: any) {
      try {
        device = new MediasoupClient.Device();
      } catch (error: any) {
        if (error.name === 'UnsupportedError') {
          console.error('browser not supported');
        }
      }
      await device.load({ routerRtpCapabilities });
    }

    async function consume(transport: any, trackKind: any) {
      console.log('--start of consume --kind=' + trackKind);
      const { rtpCapabilities } = device;
      //const data = await socket.request('consume', { rtpCapabilities });
      const data = await sendRequest('consume', {
        rtpCapabilities: rtpCapabilities,
        kind: trackKind,
      }).catch((err) => {
        console.error('consume ERROR:', err);
      });
      const { producerId, id, kind, rtpParameters } = data;

      if (producerId) {
        let codecOptions = {};
        const consumer = await transport.consume({
          id,
          producerId,
          kind,
          rtpParameters,
          codecOptions,
        });

        addRemoteTrack(clientId, consumer.track);
        console.log('--end of consume');
        return consumer;
      } else {
        console.warn('--- remote producer NOT READY');
        return null;
      }
    }

    async function subscribe() {
      // --- prepare transport ---
      console.log('--- createConsumerTransport --');
      const params = await sendRequest('createConsumerTransport', {});
      console.log('transport params:', params);
      consumerTransport = device.createRecvTransport(params);
      console.log('createConsumerTransport:', consumerTransport);

      // --- join & start publish --
      consumerTransport.on(
        'connect',
        async ({ dtlsParameters }: any, callback: any, errback: any) => {
          console.log('--consumer trasnport connect');
          sendRequest('connectConsumerTransport', {
            dtlsParameters: dtlsParameters,
          })
            .then(callback)
            .catch(errback);

          //consumer = await consumeAndResume(consumerTransport);
        }
      );

      consumerTransport.on('connectionstatechange', (state: string) => {
        switch (state) {
          case 'connecting':
            console.log('subscribing...');
            break;

          case 'connected':
            console.log('subscribed');
            break;

          case 'failed':
            console.log('failed');
            break;

          default:
            break;
        }
      });

      videoConsumer = await consumeAndResume(consumerTransport, 'video');
      audioConsumer = await consumeAndResume(consumerTransport, 'audio');
    }

    // Clear the srcobject so we load our stream when received
    const leftVideo = document.getElementById('leftVideo') as HTMLMediaElement;
    leftVideo.srcObject = null;

    await connectSocket();

    // --- get capabilities --
    const data = await sendRequest('getRouterRtpCapabilities', {});
    console.log('getRouterRtpCapabilities:', data);
    await loadDevice(data);

    await subscribe();
  };

  stopPublishingLocalStream = async () => {
    if (this.localStreamToPublish) {
      this.socket.emit('CMD:leaveScreenShare');
      // We don't actually need to unmute if it's a fileshare but this is fine
      this.doSetMute(false);
    }
    this.localStreamToPublish &&
      this.localStreamToPublish.getTracks().forEach((track) => {
        track.stop();
      });
    this.localStreamToPublish = undefined;
    if (this.consumerConn) {
      this.consumerConn.close();
      this.consumerConn = undefined;
    }
    Object.values(this.publisherConns).forEach((pc) => {
      pc.close();
    });
    this.publisherConns = {};
    this.isLocalStreamAFile = false;
  };

  setupRTCConnections = async () => {
    if (!this.isScreenShare() && !this.isFileShare()) {
      return;
    } else if (this.state.currentMedia.includes('@')) {
      let prefix = 'screenshare://';
      if (this.isFileShare()) {
        prefix = 'fileshare://';
      }
      const unprefixed = this.state.currentMedia.replace(prefix, '');
      const mediasoupURL = unprefixed.split('@')[1];
      this.consumeMediasoup(mediasoupURL);
      return;
    }
    const sharer = this.state.participants.find((p) => p.isScreenShare);
    const selfId = getAndSaveClientId();
    if (sharer && sharer.clientId === selfId) {
      // We're the sharer, create a connection to each other member

      // Delete and close any connections that aren't in the current member list (maybe someone disconnected)
      // This allows them to rejoin later
      const clientIds = new Set(this.state.participants.map((p) => p.clientId));
      Object.entries(this.publisherConns).forEach(([key, value]) => {
        if (!clientIds.has(key)) {
          value.close();
          delete this.publisherConns[key];
        }
      });

      this.state.participants.forEach((user) => {
        const id = user.clientId;
        if (id === selfId && this.isLocalStreamAFile) {
          // Don't set up a connection to ourselves if sharing file
          return;
        }
        if (!this.publisherConns[id]) {
          // Set up the RTCPeerConnection for sharing media to each member
          const pc = new RTCPeerConnection({ iceServers: iceServers() });
          this.publisherConns[id] = pc;
          this.localStreamToPublish?.getTracks().forEach((track) => {
            if (this.localStreamToPublish != null) {
              pc.addTrack(track, this.localStreamToPublish);
            }
          });
          pc.onicecandidate = (event) => {
            // We generated an ICE candidate, send it to peer
            if (event.candidate) {
              this.sendSignalSS(id, { ice: event.candidate }, true);
            }
          };
          pc.onnegotiationneeded = async () => {
            // Start connection for peer's video
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignalSS(id, { sdp: pc.localDescription }, true);
          };
        }
      });
    }
    // We're a watcher, establish connection to sharer
    // If screensharing, sharer also does this
    // If filesharing, sharer does not do this since we use leftVideo
    if (sharer && !this.consumerConn && !this.isLocalStreamAFile) {
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      this.consumerConn = pc;
      pc.onicecandidate = (event) => {
        // We generated an ICE candidate, send it to sharer
        if (event.candidate) {
          this.sendSignalSS(sharer.clientId, { ice: event.candidate });
        }
      };
      pc.ontrack = (event: RTCTrackEvent) => {
        // Mount the stream from sharer
        // console.log(stream);
        const leftVideo = document.getElementById(
          'leftVideo'
        ) as HTMLMediaElement;
        if (leftVideo) {
          leftVideo.src = '';
          leftVideo.srcObject = event.streams[0];
          this.doPlay();
        }
      };
    }
  };

  startVBrowser = async (rcToken: string, options: { size: string }) => {
    // user.uid is the public user identifier
    // user.getIdToken() is the secret access token we can send to the server to prove identity
    const user = this.props.user;
    const uid = user?.uid;
    const token = await user?.getIdToken();
    this.socket.emit('CMD:startVBrowser', { options, uid, token, rcToken });
  };

  stopVBrowser = async () => {
    this.socket.emit('CMD:stopVBrowser');
  };

  changeController = async (_e: any, data: DropdownProps) => {
    // console.log(data);
    this.socket.emit('CMD:changeController', data.value);
  };

  sendSignalSS = async (to: string, data: any, sharer?: boolean) => {
    // console.log('sendSS', to, data);
    this.socket.emit('signalSS', { to, msg: data, sharer });
  };

  isYouTube = () => {
    return getMediaType(this.state.currentMedia) === 'youtube';
  };

  isVideo = () => {
    // Anything that uses HTML Video (e.g. not YouTube)
    return getMediaType(this.state.currentMedia) === 'video';
  };

  isScreenShare = () => {
    return this.state.currentMedia.startsWith('screenshare://');
  };

  isFileShare = () => {
    return this.state.currentMedia.startsWith('fileshare://');
  };

  isVBrowser = () => {
    return this.state.currentMedia.startsWith('vbrowser://');
  };

  isHttp = () => {
    // Youtube, link, or magnet
    return (
      this.state.currentMedia.startsWith('http') ||
      this.state.currentMedia.startsWith('magnet:')
    );
  };

  getVBrowserPass = () => {
    return this.state.currentMedia.replace('vbrowser://', '').split('@')[0];
  };

  getVBrowserHost = () => {
    return this.state.currentMedia.replace('vbrowser://', '').split('@')[1];
  };

  isPauseDisabled = () => {
    return this.isScreenShare() || this.isVBrowser();
  };

  jumpToLeader = () => {
    // Jump to the leader's position
    const maxTS = this.getLeaderTime();
    if (maxTS > 0) {
      console.log('jump to leader at ', maxTS);
      this.Player().seekVideo(maxTS);
    }
  };

  doSrc = async (src: string, time: number) => {
    console.log('doSrc', src, time);
    if (this.isScreenShare() || this.isFileShare() || this.isVBrowser()) {
      // No-op as we'll set video when WebRTC completes
      return;
    }
    await this.Player().setSrcAndTime(src, time);
  };

  doPlay = async () => {
    if (!this.state.currentMedia) {
      return;
    }
    const canAutoplay = this.state.isAutoPlayable || (await testAutoplay());
    this.setState(
      { currentMediaPaused: false, isAutoPlayable: canAutoplay },
      async () => {
        if (
          !this.state.isAutoPlayable ||
          (this.localStreamToPublish && !this.isLocalStreamAFile)
        ) {
          console.log('auto-muting to allow autoplay or screenshare host');
          this.doSetMute(true);
        } else {
          this.doSetMute(false);
        }
        try {
          await this.Player().playVideo();
        } catch (e: any) {
          console.warn(e, e.name);
          if (e.name === 'NotSupportedError' && this.isHttp()) {
            this.setState({ loading: false, nonPlayableMedia: true });
          }
        }
      }
    );
  };

  doPause = () => {
    this.setState({ currentMediaPaused: true }, async () => {
      this.Player().pauseVideo();
    });
  };

  doSetMute = (muted: boolean) => {
    this.Player().setMute(muted);
    this.refreshControls();
  };

  doSetVolume = (volume: number) => {
    this.Player().setVolume(volume);
    this.refreshControls();
  };

  doSubtitle = () => {
    if (this.isVideo()) {
      this.setState({ isSubtitleModalOpen: true });
    }
    this.Player().showSubtitle();
  };

  doSetPlaybackRate = (rate: number) => {
    // emit an event to the server
    this.socket.emit('CMD:playbackRate', rate);
  };

  togglePlay = () => {
    if (!this.haveLock()) {
      return;
    }
    if (this.isPauseDisabled()) {
      return;
    }
    const shouldPlay = this.Player().shouldPlay();
    if (shouldPlay) {
      this.socket.emit('CMD:play');
      this.doPlay();
    } else {
      this.socket.emit('CMD:pause');
      this.doPause();
    }
  };

  onSeek = (e: any, time: number) => {
    let target = time;
    if (e) {
      const rect = e.target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const max = rect.width;
      target = (x / max) * this.Player().getDuration();
    }
    target = Math.max(target, 0);
    this.Player().seekVideo(target);
    this.socket.emit('CMD:seek', target);
  };

  onFullScreenChange = () => {
    this.setState({ fullScreen: Boolean(document.fullscreenElement) });
  };

  onKeydown = (e: any) => {
    if (!document.activeElement || document.activeElement.tagName === 'BODY') {
      if (e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key === 'ArrowRight') {
        this.onSeek(null, this.Player().getCurrentTime() + 15);
      } else if (e.key === 'ArrowLeft') {
        this.onSeek(null, this.Player().getCurrentTime() - 15);
      } else if (e.key === 'c') {
        this.Player().showSubtitle();
      } else if (e.key === 't') {
        this.fullScreen(false);
      } else if (e.key === 'f') {
        this.fullScreen(true);
      } else if (e.key === 'm') {
        this.toggleMute();
      }
    }
  };

  fullScreen = async (bVideoOnly: boolean) => {
    let container = document.getElementById('theaterContainer') as HTMLElement;
    if (bVideoOnly || isMobile()) {
      if (this.isVBrowser() && !isMobile()) {
        // Can't really control the VBrowser on mobile anyway, so just fullscreen the video
        // https://github.com/howardchung/watchparty/issues/208
        container = document.getElementById('leftVideoParent') as HTMLElement;
      } else {
        container = document.getElementById(
          this.isYouTube() ? 'leftYt' : 'leftVideo'
        ) as HTMLElement;
      }
    }
    if (
      !container.requestFullscreen &&
      (container as any).webkitEnterFullScreen
    ) {
      // e.g. iPhone doesn't allow requestFullscreen
      (container as any).webkitEnterFullscreen();
      return;
    }
    if (!document.fullscreenElement) {
      await container.requestFullscreen();
      return;
    }
    const bChangeElements = document.fullscreenElement !== container;
    await document.exitFullscreen();
    if (bChangeElements) {
      await container.requestFullscreen();
    }
  };

  toggleMute = () => {
    this.doSetMute(!this.Player().isMuted());
  };

  loadSubtitles = async () => {
    const leftVideo = document.getElementById('leftVideo') as HTMLMediaElement;
    if (!leftVideo) {
      return;
    }
    // Clear subtitles and put new ones in
    leftVideo.innerHTML = '';
    if (Boolean(this.state.currentSubtitle)) {
      let subtitleSrc = this.state.currentSubtitle;
      if (subtitleSrc) {
        const response = await window.fetch(subtitleSrc);
        const buffer = await response.arrayBuffer();
        const url = await toWebVTT(new Blob([buffer]));
        const track = document.createElement('track');
        track.kind = 'captions';
        track.label = 'English';
        track.srclang = 'en';
        track.src = url;
        leftVideo.appendChild(track);
        leftVideo.textTracks[0].mode = 'showing';
      }
    }
  };

  syncSubtitle = () => {
    const sharer = this.state.participants.find((p) => p.isScreenShare);
    if (!sharer || sharer.id === this.socket.id) {
      return;
    }
    // When sharing, our timestamp doesn't match the subtitles so adjust them
    // For each cue, subtract the videoTS of the sharer, then add our own
    const leftVideo = document.getElementById('leftVideo') as HTMLMediaElement;
    const track = leftVideo?.textTracks[0];
    let offset = leftVideo.currentTime - this.state.tsMap[sharer.id];
    if (track && track.cues && offset) {
      for (let i = 0; i < track.cues.length; i++) {
        let cue = track?.cues?.[i];
        if (!cue) {
          continue;
        }
        // console.log(cue.text, offset, (cue as any).origStart, (cue as any).origEnd);
        if (!(cue as any).origStart) {
          (cue as any).origStart = cue.startTime;
          (cue as any).origEnd = cue.endTime;
        }
        cue.startTime = (cue as any).origStart + offset;
        cue.endTime = (cue as any).origEnd + offset;
      }
    }
  };

  setMedia = (_e: any, data: DropdownProps) => {
    this.socket.emit('CMD:host', data.value);
  };

  playlistAdd = (_e: any, data: DropdownProps) => {
    this.socket.emit('CMD:playlistAdd', data.value);
  };

  playlistMove = (index: number, toIndex: number) => {
    this.socket.emit('CMD:playlistMove', { index, toIndex });
  };

  playlistDelete = (index: number) => {
    this.socket.emit('CMD:playlistDelete', index);
  };

  updateName = (_e: any, data: { value: string }) => {
    this.setState({ myName: data.value });
    this.socket.emit('CMD:name', data.value);
    window.localStorage.setItem('watchparty-username', data.value);
  };

  updatePicture = (url: string) => {
    this.setState({ myPicture: url });
    this.socket.emit('CMD:picture', url);
  };

  updateUid = async (user: firebase.User) => {
    const uid = user.uid;
    const token = await user.getIdToken();
    this.socket.emit('CMD:uid', { uid, token });
  };

  getMediaDisplayName = (input: string) => {
    if (!input) {
      return '';
    }
    // Show the whole URL for youtube
    if (this.isYouTube()) {
      return input;
    }
    if (input.startsWith('screenshare://')) {
      const sharer = this.state.participants.find((user) => user.isScreenShare);
      return this.state.nameMap[sharer?.id ?? ''] + "'s screen";
    }
    if (input.startsWith('fileshare://')) {
      const sharer = this.state.participants.find((user) => user.isScreenShare);
      return this.state.nameMap[sharer?.id ?? ''] + "'s file";
    }
    if (input.startsWith('vbrowser://')) {
      return 'Virtual Browser' + (this.state.isVBrowserLarge ? '+' : '');
    }
    if (input.startsWith('magnet:')) {
      const magnetParsed = new URLSearchParams(input);
      const index = magnetParsed.get('fileIndex');
      return magnetParsed.get('dn') + (index != null ? ` (file ${index})` : '');
    }
    if (input.includes('/stream?torrent=magnet')) {
      const search = new URL(input).search;
      const searchParsed = new URLSearchParams(search);
      const magnetUrl = searchParsed.get('torrent') ?? '';
      const magnetParsed = new URLSearchParams(magnetUrl);
      const index = searchParsed.get('fileIndex');
      return magnetParsed.get('dn') + (index != null ? ` (file ${index})` : '');
    }
    return input;
  };

  setLoadingFalse = () => {
    this.setState({ loading: false });
  };

  getLeaderTime = () => {
    if (this.state.participants.length > 2) {
      return calculateMedian(Object.values(this.state.tsMap));
    }
    return Math.max(...Object.values(this.state.tsMap));
  };

  onVideoEnded = () => {
    this.socket.emit('CMD:playlistNext', this.state.currentMedia);
    // Play next
    const re = /&fileIndex=(\d+)$/;
    const match = re.exec(this.state.currentMedia);
    if (match) {
      const fileIndex = match[1];
      const nextNum = Number(fileIndex) + 1;
      const nextUrl = this.state.currentMedia.replace(
        /&fileIndex=(\d+)$/,
        `&fileIndex=${nextNum}`
      );
      this.setMedia(null, { value: nextUrl });
    }
  };

  refreshControls = () => {
    this.setState({ controlsTimestamp: Number(new Date()) });
  };

  render() {
    const sharer = this.state.participants.find((p) => p.isScreenShare);
    const controls = (
      <Controls
        key={this.state.controlsTimestamp}
        togglePlay={this.togglePlay}
        onSeek={this.onSeek}
        fullScreen={this.fullScreen}
        toggleMute={this.toggleMute}
        showSubtitle={this.doSubtitle}
        setVolume={this.doSetVolume}
        jumpToLeader={this.jumpToLeader}
        paused={this.state.currentMediaPaused}
        muted={this.Player().isMuted()}
        volume={this.Player().getVolume()}
        subtitled={this.Player().isSubtitled()}
        currentTime={this.Player().getCurrentTime()}
        duration={this.Player().getDuration()}
        disabled={!this.haveLock()}
        leaderTime={this.isHttp() ? this.getLeaderTime() : undefined}
        isPauseDisabled={this.isPauseDisabled()}
        playbackRate={this.Player().getPlaybackRate()}
        setPlaybackRate={this.doSetPlaybackRate}
        beta={this.props.beta}
        roomPlaybackRate={this.state.roomPlaybackRate}
        isYouTube={this.isYouTube()}
        setSubtitleMode={this.Player().setSubtitleMode}
      />
    );
    const displayRightContent =
      this.state.showRightBar || this.state.fullScreen;
    const rightBar = (
      <Grid.Column
        width={displayRightContent ? 4 : 1}
        style={{ display: 'flex', flexDirection: 'column' }}
        className={`${
          this.state.fullScreen
            ? 'fullHeightColumnFullscreen'
            : 'fullHeightColumn'
        }`}
      >
        <Form autoComplete="off">
          <Input
            inverted
            fluid
            label={'My name is:'}
            value={this.state.myName}
            onChange={this.updateName}
            style={{ visibility: displayRightContent ? '' : 'hidden' }}
            icon={
              <Icon
                onClick={async () =>
                  this.updateName(null, { value: await generateName() })
                }
                name="random"
                inverted
                circular
                link
                title="Generate a random name"
              />
            }
          />
        </Form>
        {
          <Menu
            inverted
            widths={3}
            style={{
              marginTop: '4px',
              marginBottom: '4px',
              visibility: displayRightContent ? '' : 'hidden',
            }}
          >
            <Menu.Item
              name="chat"
              active={this.state.currentTab === 'chat'}
              onClick={() => {
                this.setState({ currentTab: 'chat', unreadCount: 0 });
              }}
              as="a"
            >
              Chat
              {this.state.unreadCount > 0 && (
                <Label circular color="red">
                  {this.state.unreadCount}
                </Label>
              )}
            </Menu.Item>
            <Menu.Item
              name="people"
              active={this.state.currentTab === 'people'}
              onClick={() => this.setState({ currentTab: 'people' })}
              as="a"
            >
              People
              <Label
                circular
                color={
                  getColorForString(
                    this.state.participants.length.toString()
                  ) as SemanticCOLORS
                }
              >
                {this.state.participants.length}
              </Label>
            </Menu.Item>
            <Menu.Item
              name="settings"
              active={this.state.currentTab === 'settings'}
              onClick={() => this.setState({ currentTab: 'settings' })}
              as="a"
            >
              {/* <Icon name="setting" /> */}
              Settings
            </Menu.Item>
          </Menu>
        }
        <Chat
          chat={this.state.chat}
          nameMap={this.state.nameMap}
          pictureMap={this.state.pictureMap}
          socket={this.socket}
          scrollTimestamp={this.state.scrollTimestamp}
          getMediaDisplayName={this.getMediaDisplayName}
          hide={this.state.currentTab !== 'chat' || !displayRightContent}
          isChatDisabled={this.state.isChatDisabled}
          owner={this.state.owner}
          user={this.props.user}
          ref={this.chatRef}
        />
        {this.state.state === 'connected' && (
          <VideoChat
            socket={this.socket}
            participants={this.state.participants}
            nameMap={this.state.nameMap}
            pictureMap={this.state.pictureMap}
            tsMap={this.state.tsMap}
            rosterUpdateTS={this.state.rosterUpdateTS}
            hide={this.state.currentTab !== 'people' || !displayRightContent}
            owner={this.state.owner}
            user={this.props.user}
            beta={this.props.beta}
            getLeaderTime={this.getLeaderTime}
          />
        )}
        <SettingsTab
          hide={this.state.currentTab !== 'settings' || !displayRightContent}
          user={this.props.user}
          roomLock={this.state.roomLock}
          setRoomLock={this.setRoomLock}
          socket={this.socket}
          isSubscriber={this.props.isSubscriber}
          roomId={this.state.roomId}
          isChatDisabled={this.state.isChatDisabled}
          setIsChatDisabled={this.setIsChatDisabled}
          owner={this.state.owner}
          setOwner={this.setOwner}
          vanity={this.state.vanity}
          setVanity={this.setVanity}
          roomLink={this.state.roomLink}
          password={this.state.password}
          setPassword={this.setPassword}
          clearChat={this.clearChat}
          roomTitle={this.state.roomTitle}
          setRoomTitle={this.setRoomTitle}
          roomDescription={this.state.roomDescription}
          setRoomDescription={this.setRoomDescription}
          roomTitleColor={this.state.roomTitleColor}
          setRoomTitleColor={this.setRoomTitleColor}
          mediaPath={this.state.mediaPath}
          setMediaPath={this.setMediaPath}
        />
      </Grid.Column>
    );
    return (
      <React.Fragment>
        {!this.state.isAutoPlayable && (
          <Modal inverted="true" basic open>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Button
                primary
                size="large"
                onClick={() => {
                  this.setState({ isAutoPlayable: true });
                  this.doSetMute(false);
                  this.doSetVolume(1);
                }}
                icon
                labelPosition="left"
              >
                <Icon name="volume up" />
                Click to unmute
              </Button>
            </div>
          </Modal>
        )}
        {this.state.multiStreamSelection && (
          <MultiStreamModal
            streams={this.state.multiStreamSelection}
            setMedia={this.setMedia}
            resetMultiSelect={this.resetMultiSelect}
          />
        )}
        {this.state.isVBrowserModalOpen && (
          <VBrowserModal
            isSubscriber={this.props.isSubscriber}
            closeModal={() => this.setState({ isVBrowserModalOpen: false })}
            startVBrowser={this.startVBrowser}
            user={this.props.user}
            beta={this.props.beta}
          />
        )}
        {this.state.isScreenShareModalOpen && (
          <ScreenShareModal
            beta={this.props.beta}
            closeModal={() => this.setState({ isScreenShareModalOpen: false })}
            startScreenShare={this.startScreenShare}
          />
        )}
        {this.state.isFileShareModalOpen && (
          <FileShareModal
            beta={this.props.beta}
            closeModal={() => this.setState({ isFileShareModalOpen: false })}
            startFileShare={this.startFileShare}
          />
        )}
        {this.state.isSubtitleModalOpen && (
          <SubtitleModal
            closeModal={() => this.setState({ isSubtitleModalOpen: false })}
            socket={this.socket}
            currentSubtitle={this.state.currentSubtitle}
            src={this.state.currentMedia}
            haveLock={this.haveLock}
            getMediaDisplayName={this.getMediaDisplayName}
            beta={this.props.beta}
            setSubtitleMode={this.Player().setSubtitleMode}
            getSubtitleMode={this.Player().getSubtitleMode}
          />
        )}
        {this.state.overlayMsg && <ErrorModal error={this.state.overlayMsg} />}
        {this.state.isErrorAuth && (
          <PasswordModal
            savedPasswords={this.state.savedPasswords}
            roomId={this.state.roomId}
          />
        )}
        {this.state.errorMessage && (
          <Message
            negative
            header="Error"
            content={this.state.errorMessage}
            style={{
              position: 'fixed',
              bottom: '10px',
              right: '10px',
              zIndex: 1000,
            }}
          ></Message>
        )}
        {this.state.successMessage && (
          <Message
            positive
            header="Success"
            content={this.state.successMessage}
            style={{
              position: 'fixed',
              bottom: '10px',
              right: '10px',
              zIndex: 1000,
            }}
          ></Message>
        )}
        {this.state.warningMessage && (
          <Message
            warning
            // header={this.state.warningMessage}
            content={this.state.warningMessage}
            style={{
              position: 'fixed',
              top: '10px',
              left: '50%',
              transform: 'translate(-50%, 0)',
              zIndex: 1000,
            }}
          ></Message>
        )}
        <TopBar
          user={this.props.user}
          isCustomer={this.props.isCustomer}
          isSubscriber={this.props.isSubscriber}
          roomTitle={this.state.roomTitle}
          roomDescription={this.state.roomDescription}
          roomTitleColor={this.state.roomTitleColor}
          showInviteButton
        />
        {
          <Grid stackable celled="internally">
            <Grid.Row id="theaterContainer">
              <Grid.Column
                width={this.state.showRightBar ? 12 : 15}
                className={
                  this.state.fullScreen
                    ? 'fullHeightColumnFullscreen'
                    : 'fullHeightColumn'
                }
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                  }}
                >
                  {!this.state.fullScreen && (
                    <React.Fragment>
                      <ComboBox
                        setMedia={this.setMedia}
                        playlistAdd={this.playlistAdd}
                        playlistDelete={this.playlistDelete}
                        playlistMove={this.playlistMove}
                        currentMedia={this.state.currentMedia}
                        getMediaDisplayName={this.getMediaDisplayName}
                        launchMultiSelect={this.launchMultiSelect}
                        streamPath={this.props.streamPath}
                        mediaPath={this.state.mediaPath}
                        disabled={!this.haveLock()}
                        playlist={this.state.playlist}
                      />
                      <Separator />
                      <div
                        className="mobileStack"
                        style={{ display: 'flex', gap: '4px' }}
                      >
                        {this.localStreamToPublish && (
                          <Button
                            fluid
                            className="toolButton"
                            icon
                            labelPosition="left"
                            color="red"
                            onClick={this.stopPublishingLocalStream}
                            disabled={sharer?.id !== this.socket?.id}
                          >
                            <Icon name="cancel" />
                            Stop Share
                          </Button>
                        )}
                        {!this.localStreamToPublish &&
                          !sharer &&
                          !this.isVBrowser() && (
                            <Popup
                              content={`Share a tab or an application.`}
                              trigger={
                                <Button
                                  fluid
                                  className="toolButton"
                                  disabled={!this.haveLock()}
                                  icon
                                  labelPosition="left"
                                  color={'instagram'}
                                  onClick={() => {
                                    this.setState({
                                      isScreenShareModalOpen: true,
                                    });
                                  }}
                                >
                                  <Icon name={'slideshare'} />
                                  Screenshare
                                </Button>
                              }
                            />
                          )}
                        {!this.localStreamToPublish &&
                          !sharer &&
                          !this.isVBrowser() && (
                            <Popup
                              content="Launch a shared virtual browser"
                              trigger={
                                <Button
                                  fluid
                                  className="toolButton"
                                  disabled={!this.haveLock()}
                                  icon
                                  labelPosition="left"
                                  color="green"
                                  onClick={() => {
                                    this.setState({
                                      isVBrowserModalOpen: true,
                                    });
                                  }}
                                >
                                  <Icon name="desktop" />
                                  VBrowser
                                </Button>
                              }
                            />
                          )}
                        {this.isVBrowser() && (
                          <Popup
                            content="Choose the person controlling the VBrowser"
                            trigger={
                              <Dropdown
                                icon="keyboard"
                                labeled
                                className="icon"
                                style={{ height: '36px' }}
                                button
                                value={this.state.controller}
                                placeholder="No controller"
                                clearable
                                onChange={this.changeController}
                                selection
                                disabled={!this.haveLock()}
                                options={this.state.participants.map((p) => ({
                                  text: this.state.nameMap[p.id] || p.id,
                                  value: p.id,
                                }))}
                              ></Dropdown>
                            }
                          />
                        )}
                        {this.isVBrowser() && (
                          <Dropdown
                            icon="desktop"
                            labeled
                            className="icon"
                            style={{ height: '36px' }}
                            button
                            disabled={!this.haveLock()}
                            value={this.state.vBrowserResolution}
                            onChange={(_e, data) =>
                              this.setState({
                                vBrowserResolution: data.value as string,
                              })
                            }
                            selection
                            options={[
                              {
                                text: '1080p (Plus only)',
                                value: '1920x1080@30',
                                disabled: !this.state.isVBrowserLarge,
                              },
                              {
                                text: '720p',
                                value: '1280x720@30',
                              },
                              {
                                text: '576p',
                                value: '1024x576@60',
                              },
                              {
                                text: '486p',
                                value: '864x486@60',
                              },
                              {
                                text: '360p',
                                value: '640x360@60',
                              },
                            ]}
                          ></Dropdown>
                        )}
                        {this.isVBrowser() && (
                          <Button
                            fluid
                            className="toolButton"
                            icon
                            labelPosition="left"
                            color="red"
                            disabled={!this.haveLock()}
                            onClick={this.stopVBrowser}
                          >
                            <Icon name="cancel" />
                            Stop VBrowser
                          </Button>
                        )}
                        {!this.localStreamToPublish &&
                          !sharer &&
                          !this.isVBrowser() && (
                            <Popup
                              content="Stream your own video file"
                              trigger={
                                <Button
                                  fluid
                                  className="toolButton"
                                  disabled={!this.haveLock()}
                                  icon
                                  labelPosition="left"
                                  onClick={() => {
                                    this.setState({
                                      isFileShareModalOpen: true,
                                    });
                                  }}
                                >
                                  <Icon name="file" />
                                  File
                                </Button>
                              }
                            />
                          )}
                        {false && (
                          <SearchComponent
                            setMedia={this.setMedia}
                            playlistAdd={this.playlistAdd}
                            type={'youtube'}
                            streamPath={this.props.streamPath}
                            disabled={!this.haveLock()}
                          />
                        )}
                        {Boolean(this.props.streamPath) && (
                          <SearchComponent
                            setMedia={this.setMedia}
                            playlistAdd={this.playlistAdd}
                            type={'stream'}
                            streamPath={this.props.streamPath}
                            launchMultiSelect={this.launchMultiSelect}
                            disabled={!this.haveLock()}
                          />
                        )}
                      </div>
                      <Separator />
                    </React.Fragment>
                  )}
                  <div style={{ flexGrow: 1 }}>
                    <div id="playerContainer">
                      {(this.state.loading ||
                        !this.state.currentMedia ||
                        this.state.nonPlayableMedia) && (
                        <div
                          id="loader"
                          className="videoContent"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {this.state.loading && (
                            <Dimmer active>
                              <Loader>
                                {this.isVBrowser()
                                  ? 'Launching virtual browser. This can take up to a minute.'
                                  : ''}
                              </Loader>
                            </Dimmer>
                          )}
                          {!this.state.loading && !this.state.currentMedia && (
                            <Message
                              color="yellow"
                              icon="hand point up"
                              header="You're not watching anything!"
                              content="Pick something to watch above."
                            />
                          )}
                          {!this.state.loading &&
                            this.state.nonPlayableMedia && (
                              <Message
                                color="red"
                                icon="frown"
                                header="It doesn't look like this is a media file!"
                                content="Maybe you meant to launch a VBrowser if you're trying to visit a web page?"
                              />
                            )}
                        </div>
                      )}
                      <iframe
                        style={{
                          display:
                            this.isYouTube() && !this.state.loading
                              ? 'block'
                              : 'none',
                        }}
                        title="YouTube"
                        id="leftYt"
                        className="videoContent"
                        allowFullScreen
                        frameBorder="0"
                        allow="autoplay"
                        src="https://www.youtube.com/embed/?enablejsapi=1&controls=0&rel=0"
                      />
                      {this.isVBrowser() &&
                      this.getVBrowserPass() &&
                      this.getVBrowserHost() ? (
                        <VBrowser
                          username={this.socket.id}
                          password={this.getVBrowserPass()}
                          hostname={this.getVBrowserHost()}
                          controlling={this.state.controller === this.socket.id}
                          resolution={this.state.vBrowserResolution}
                          doPlay={this.doPlay}
                          setResolution={(data: string) =>
                            this.setState({ vBrowserResolution: data })
                          }
                        />
                      ) : (
                        <video
                          style={{
                            display:
                              (this.isVideo() && !this.state.loading) ||
                              this.state.fullScreen
                                ? 'block'
                                : 'none',
                            width: '100%',
                            maxHeight:
                              'calc(100vh - 62px - 36px - 36px - 8px - 41px - 16px)',
                          }}
                          id="leftVideo"
                          onEnded={this.onVideoEnded}
                          playsInline
                          onClick={this.togglePlay}
                        ></video>
                      )}
                    </div>
                  </div>
                  {this.state.currentMedia && controls}
                  {Boolean(this.state.total) && (
                    <div
                      style={{
                        color: 'white',
                        textAlign: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        marginTop: -10,
                      }}
                    >
                      {/* <Progress
                        size="tiny"
                        color="green"
                        inverted
                        value={this.state.downloaded}
                        total={this.state.total}
                        // indicating
                        label={}
                      ></Progress> */}
                      {Math.min(
                        (this.state.downloaded / this.state.total) * 100,
                        100
                      ).toFixed(2) +
                        '% - ' +
                        formatSpeed(this.state.speed) +
                        ' - ' +
                        this.state.connections +
                        ' connections'}
                    </div>
                  )}
                </div>
                {!isMobile() && (
                  <Button
                    style={{
                      position: 'absolute',
                      top: '50%',
                      right: 'calc(0% - 18px)',
                      zIndex: 900,
                    }}
                    circular
                    size="mini"
                    icon={
                      this.state.showRightBar ? 'angle right' : 'angle left'
                    }
                    onClick={() =>
                      this.setState({ showRightBar: !this.state.showRightBar })
                    }
                  />
                )}
              </Grid.Column>
              {rightBar}
            </Grid.Row>
          </Grid>
        }
      </React.Fragment>
    );
  }
}

export const Separator = () => <div style={{ height: '4px', flexShrink: 0 }} />;
