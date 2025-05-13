const postsContainer = document.getElementById("posts");
const LOAD_MORE_COOLDOWN = 8000; // Cooldown for the "Load More" button
const POSTS_PER_PAGE = 10; // Number of posts to load per request
let skipCount = 0; // Number of posts already loaded
let loadMoreButtonEnabled = true; // Toggle for "Load More" button state
let isLoading = false; // Toggle for loading state
let currentTag = ""; // Currently selected tag
let abortController = new AbortController();

// Sanitize user-generated content to prevent XSS
function sanitizeHTML(str) {
    const temp = document.createElement("div");
    temp.textContent = str;
    return temp.innerHTML;
  }
  function getBadgeTooltip(badge) {
    switch (badge) {
        case '👑': return { label: 'Admin', color: '#FFD700' };
        case '🛡️': return { label: 'Moderator', color: '#1E90FF' };
        case '🌟': return { label: 'Elite Member', color: '#FF69B4' };
        case '✨': return { label: 'Gold Member', color: '#FFA500' };
        default: return { label: 'Fapper', color: '#8ba2ad' };
    }
}


// Render a single post
function renderPost(post) {
    const postElement = document.createElement("div");
    postElement.classList.add("post-card");
    const isLiked = userLikes.includes(post._id);
    const likeIcon = isLiked ? "/icons/liked.png" : "/icons/like.gif";
    const sanitizedAuthor = sanitizeHTML(post.author);
    const sanitizedId = sanitizeHTML(post._id);
    const sanitizedPic = sanitizeHTML(post.authorpic);
    const badgeData = getBadgeTooltip(post.authorbadge);
    

    const isSaved = userSaves.includes(post._id);
    const Savesvg = isSaved ? `<svg fill="currentColor" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" 
               class="save-icon">
              <path d="M4.114 20A1.117 1.117 0 0 1 3 18.884V2.628A1.629 1.629 0 0 1 4.628 1h10.744A1.63 1.63 0 0 1 17 2.628v16.245a1.12 1.12 0 0 1-1.718.946L10 16.479l-5.291 3.346a1.11 1.11 0 0 1-.595.175Z" />
            </svg>` : ` <svg fill="none" stroke="currentColor" stroke-width="1.5" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg" class="save-icon">
              <path d="M4.114 20A1.117 1.117 0 0 1 3 18.884V2.628A1.629 1.629 0 0 1 4.628 1h10.744A1.63 1.63 0 0 1 17 2.628v16.245a1.12 1.12 0 0 1-1.718.946L10 16.479l-5.291 3.346a1.11 1.11 0 0 1-.595.175Z"/>
          </svg>`;

    postElement.innerHTML = `
  <div class="card-head">

     <div class="card-author" >
     <p onclick="redirectToProfile('${sanitizedAuthor}')" >
       <img src="/icons/avatars/avatar${sanitizedPic}.jpg" alt=""> 
        &nbsp;&nbsp;/${sanitizedAuthor}
     </p>&nbsp;
        <span class="tooltip">
            <p id="badge-${sanitizedId}-${sanitizedAuthor}" ></p>
            <span class="tooltiptext" id="tooltip-${sanitizedId}-${sanitizedAuthor}" >
                ${badgeData.label}1
            </span>
        </span>
        &nbsp;&nbsp;<p style="font-size:10px;color:#8ba2ad;">${timeAgo(post.uploadTime)}</p>
    </div>

    <div class="ellipse" onclick="ShowPostOptions('${sanitizeHTML(post._id)}')">
       <svg xmlns="http://www.w3.org/2000/svg" width="24" height="18" viewBox="0 0 24 24" fill="currentColor" 
          style="transform: rotateZ(90deg);"> 
          <circle cx="5" cy="12" r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="19" cy="12" r="2"/>
      </svg>
    </div>
  </div>
    <div class="post-options" style="display:none" id="post-options-${sanitizeHTML(post._id)}">
    <div class="menu">
        <ul class="menu-list">

        <li class="menu-item" onclick="redirectToProfile('${sanitizeHTML(post.author)}')">
              <div class="menu-content" tabindex="-1">
                  <span class="icon-text">
                      <span class="icon" id="follow-icon-${sanitizeHTML(post._id)}">
                          ${userFollowing.includes(post.author) ? `
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20px" fill="#8ba2ad">
                              <g data-name="4-User-Remove">
                                  <path d="M2 29c0-.78 1.92-1.7 3.24-2h.11l8-3a1 1 0 0 0 .65-1v-2.69a1 1 0 0 0-.57-.9A6 6 0 0 1 10 14a1 1 0 0 0-1-1v-2a1 1 0 0 0 1-1V8a6 6 0 0 1 12 0v2a1 1 0 0 0 1 1v2h2v-2a2 2 0 0 0-1-1.73V8A8 8 0 0 0 8 8v1.27A2 2 0 0 0 7 11v2a2 2 0 0 0 1 1.75 8.07 8.07 0 0 0 4 6.16v1.39L4.7 25c-.91.23-4.7 1.37-4.7 4v2a1 1 0 0 0 1 1h14v-2H2z"/>
                                  <path d="M24 16a8 8 0 1 0 8 8 8 8 0 0 0-8-8zm0 14a6 6 0 1 1 6-6 6 6 0 0 1-6 6z"/>
                                  <path d="M20 23h8v2h-8z"/>
                              </g>
                          </svg>` : `
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="20px" fill="#8ba2ad">
                              <g data-name="3-User-Add">
                                  <path d="M2 29c0-.78 1.92-1.7 3.24-2h.11l8-3a1 1 0 0 0 .65-1v-2.69a1 1 0 0 0-.57-.9A6 6 0 0 1 10 14a1 1 0 0 0-1-1v-2a1 1 0 0 0 1-1V8a6 6 0 0 1 12 0v2a1 1 0 0 0 1 1v2h2v-2a2 2 0 0 0-1-1.73V8A8 8 0 0 0 8 8v1.27A2 2 0 0 0 7 11v2a2 2 0 0 0 1 1.75 8.07 8.07 0 0 0 4 6.16v1.39L4.7 25c-.91.23-4.7 1.37-4.7 4v2a1 1 0 0 0 1 1h14v-2H2z"/>
                                  <path d="M24 16a8 8 0 1 0 8 8 8 8 0 0 0-8-8zm0 14a6 6 0 1 1 6-6 6 6 0 0 1-6 6z"/>
                                  <path d="M25 20h-2v3h-3v2h3v3h2v-3h3v-2h-3v-3z"/>
                              </g>
                          </svg>`}
                      </span>
                      <span class="text post-follow-btn">
                          ${userFollowing
                            .includes(post.author) ? 'Unfollow' : 'Follow'}
                      </span>
                  </span>
              </div>
          </li>


            <li class="menu-item" onclick="SavePost('${sanitizeHTML(post._id)}')"> 
                <div class="menu-content" tabindex="0">
                    <span class="icon-text">
                        <span class="icon"> 
                          ${Savesvg}

                        </span>
                        <span class="text">Save</span>
                    </span>
                </div>
            </li>

            ${userID === post.author ? `
              <li class="menu-item" onclick="DeletePost('${sanitizeHTML(post._id)}')"> 
                  <div class="menu-content" tabindex="0">
                      <span class="icon-text">
                          <span class="icon"> 
                             <svg class="delete-svgIcon" viewBox="0 0 448 512" width="18px" >
                                  <path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z" fill="none" stroke="#8ba2ad" stroke-width="34px"></path>
                              </svg>
                          </span>
                          <span class="text">Delete</span>
                      </span>
                  </div>
              </li>
              ` : ''}

            
            <li class="menu-item" onclick="ReportPost('${sanitizeHTML(post._id)}')" > 
                <div class="menu-content" tabindex="-1">
                    <span class="icon-text">
                        <span class="icon">
                          <svg class="w-[40px] h-[40px] text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 14v7M5 4.971v9.541c5.6-5.538 8.4 2.64 14-.086v-9.54C13.4 7.61 10.6-.568 5 4.97Z"/>
                          </svg>


                        </span>
                        <span class="text">Report</span>
                    </span>
                </div>
            </li>
        </ul>
        <div class="extra-actions">
            <slot name="devvit-context-actions"></slot>
        </div>
    </div>
</div>

  <div class="card-title">
    <h3 id="post-title" onclick="loadpostdetails('${sanitizeHTML(post._id)}')">
      <a style="text-decoration: none; color: inherit;">
        ${sanitizeHTML(post.title)}
      </a>
    </h3>
  </div>
  ${post.images.length > 0 ? `
    <div class="img-container">
      ${post.images.length > 1 ? `<button class="slider-btn s-l" onclick="prevImage('${sanitizeHTML(post._id)}')">&#10094;</button>` : ''}
      <img id="img-${sanitizeHTML(post._id)}" 
           src="${sanitizeHTML(post.images[0].src)}" 
           alt="Click to Retry"
           data-images='${sanitizeHTML(JSON.stringify(post.images.map(img => img.src)))}'
           onclick="openFullscreenImage('${sanitizeHTML(post._id)}')"
           loading="lazy">
      ${post.images.length > 1 ? `<button class="slider-btn s-r" onclick="nextImage('${sanitizeHTML(post._id)}')">&#10095;</button>` : ''}
      <div id="img-counter-${sanitizeHTML(post._id)}" 
           class="image-counter" 
           style="position: absolute; bottom: 5px; right: 44%; background: rgba(0,0,0,0.5); color: #fff; padding: 2px 5px; border-radius: 3px;font-size: 12px;">
        1 / ${post.images.length}
      </div>
    </div>
  ` : '<p>No attachments found for this post.</p>'}
  <div class="card-interaction">
    <div class="c-i-left">
      <div class="likes" onclick="addLike('${sanitizeHTML(post._id)}')">
        <img id="like-icon-${sanitizeHTML(post._id)}" src="${likeIcon}" alt=""/> 
        <p class="like-count" id="like-count-${sanitizeHTML(post._id)}">${post.likes}</p>
      </div>
      <div class="comment" onclick="fetchComments('${sanitizeHTML(post._id)}')">
        <img src="/icons/comment.gif" alt=""> ${post.comments}
      </div>
    </div>
    <div class="c-i-right">
      <div class="share" onclick="sharePost('${sanitizeHTML(post._id)}')" style="min-width:50px">
        <span class="money-need" style="font-size:22px">share</span>
      </div>
    </div>
  </div>
`;

    // Preload images (only the first 3 for performance)
    if (post.images.length > 0) {
      post.images.slice(0, 3).forEach(img => {
        const preloadedImage = new Image();
        preloadedImage.src = img.src;
      });
    }

    return postElement;
}

// Manage the "Load More" button
function manageLoadMoreButton(postsLoaded) {
    let loadMoreButton = document.getElementById("loadMoreButton");
    if (!loadMoreButton && postsLoaded === POSTS_PER_PAGE) {
      loadMoreButton = document.createElement("button");
      loadMoreButton.id = "loadMoreButton";
      loadMoreButton.textContent = "Load More";
      loadMoreButton.addEventListener("click", handleLoadMoreClick);
      postsContainer.appendChild(loadMoreButton);
    } else if (loadMoreButton && postsLoaded < POSTS_PER_PAGE) {
      loadMoreButton.remove();
    } else if (loadMoreButton) {
      // Ensure button stays at the end
      postsContainer.appendChild(loadMoreButton);
    }
  }

  // Handle "Load More" button click
  function handleLoadMoreClick() {
    if (loadMoreButtonEnabled) {
      loadMoreButtonEnabled = false;
      const loadMoreButton = document.getElementById("loadMoreButton");
      loadMoreButton.textContent = "Loading...";
      loadMoreButton.style.color = "#7f7f7f";
      fetchAndRenderPosts(currentTag).then(() => {
        loadMoreButton.textContent = "Load More";
        loadMoreButtonEnabled = true;
      });
      loadMoreButton.disabled = true;
      setTimeout(() => {
        loadMoreButton.disabled = false;
        loadMoreButton.style.color = "white";
      }, LOAD_MORE_COOLDOWN);
    }
  }
   // Handle tag clicks
   function handleTagClick(tag) {
    currentTag = tag;
    skipCount = 0;
    postsContainer.innerHTML = "";

    // Reset styles for all tags
    document.querySelectorAll(".tag").forEach(tagElement => {
      tagElement.style.background = "";
    });

    // Apply pressed style to the selected tag
    const selectedTagElement = document.querySelector(`.tag[data-tag="${tag}"]`);
    if (selectedTagElement) {
      selectedTagElement.style.background = "#2a3236";
    }

    document.getElementById('loading-overlay').style.display = 'flex';
    fetchAndRenderPosts(currentTag);
  }

  function timeAgo(isoDate) {
    const timeUnits = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "day", seconds: 86400 },
      { label: "hr", seconds: 3600 },
      { label: "min", seconds: 60 }
    ];
    const now = new Date();
    const past = new Date(isoDate);
    const diffInSeconds = Math.floor((now - past) / 1000);
    for (let unit of timeUnits) {
      const interval = Math.floor(diffInSeconds / unit.seconds);
      if (interval >= 1) {
        return `${interval} ${unit.label}${interval > 1 ? "s" : ""} ago`;
      }
    }
    return "just now";
  }




  // Handle infinite scroll
let scrollTimeout;
window.addEventListener("scroll", () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const scrollPosition = window.scrollY + window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      if (scrollPosition >= documentHeight * 0.75 && !isLoading) {
        fetchAndRenderPosts(currentTag);
      }
    }, 200); // Adjust debounce delay as needed
  });



